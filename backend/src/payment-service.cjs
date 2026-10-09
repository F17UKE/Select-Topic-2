const generatePromptPayPayload = require('promptpay-qr');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const { HttpError } = require('./http.cjs');
const { VerificationProviderError, identifiersMatch, normalizeIdentifier } = require('./payment-verifier.cjs');
const { notifySafely } = require('./line-order-notifier.cjs');
const { enqueueNotification } = require('./notification-outbox.cjs');
const { satang } = require('./payment-money.cjs');
const { createFinanceService } = require('./finance-service.cjs');

const activeStatuses = ['PENDING', 'SUBMITTED', 'PROCESSING'];
const moneyNumber = (value) => value === null || value === undefined ? null : Number(value);
const toCents = satang;

function recipientTypeMatches(actual, expected) {
  if (!actual) return true;
  const normalized = String(actual).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const accepted = {
    PHONE: ['MSISDN', 'PHONE'],
    NATIONAL_ID: ['NATID', 'NATIONALID'],
    TAX_ID: ['NATID', 'TAXID'],
    EWALLET: ['EWALLET', 'EWALLETID'],
  };
  return (accepted[expected] || []).includes(normalized);
}

function maskIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  return normalized.length <= 4 ? normalized : `${'*'.repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
}

function validatePromptPay(type, value) {
  const normalized = normalizeIdentifier(value);
  const valid = (type === 'PHONE' && /^0\d{9}$/.test(normalized))
    || (['NATIONAL_ID', 'TAX_ID'].includes(type) && /^\d{13}$/.test(normalized))
    || (type === 'EWALLET' && /^\d{15}$/.test(normalized));
  if (!valid) throw new HttpError(422, 'merchant_promptpay_invalid', 'Merchant PromptPay configuration is invalid');
  return normalized;
}

function serializePayment(payment, slip, verification) {
  let diagnostic;
  if (process.env.NODE_ENV !== 'production' && verification?.provider_response) {
    try {
      const raw = typeof verification.provider_response === 'string'
        ? JSON.parse(verification.provider_response) : verification.provider_response;
      diagnostic = {
        stage: raw.verification_stage || null,
        provider_code: raw.failure_code || raw.error_code || null,
        http_status: Number.isInteger(raw.http_status) ? raw.http_status : null,
        request_id: raw.request_id || verification.provider_request_id || null,
      };
    } catch { /* Corrupt diagnostics are never exposed. */ }
  }
  const providerResultStaged = verification?.status === 'PROCESSING'
    && Boolean(verification.provider_transaction_reference)
    && verification.reported_amount !== null
    && verification.reported_amount !== undefined
    && verification.amount_matches === true
    && verification.recipient_matches === true
    && !verification.failure_code;
  const providerInProgress = payment.status === 'PROCESSING'
    || payment.verification_status === 'PROCESSING'
    || verification?.status === 'PROCESSING';
  const providerRetryable = verification?.status === 'ERROR'
    || payment.verification_status === 'ERROR';
  const reconciliationAvailable = Boolean(slip) && payment.status !== 'PAID'
    && (providerResultStaged || providerInProgress || providerRetryable);
  return {
    id: payment.id, order_id: payment.order_id, method: payment.method,
    status: payment.status, verification_status: payment.verification_status,
    paid_at: payment.paid_at, verified_at: payment.verified_at,
    expected_amount: moneyNumber(payment.expected_amount),
    amount_transferred: moneyNumber(payment.amount_transferred),
    reconciliation_available: reconciliationAvailable,
    reconciliation_required: reconciliationAvailable && providerInProgress,
    slip: slip ? {
      id: slip.id,
      uploaded_at: slip.uploaded_at,
      purge_after: slip.purge_after,
    } : null,
    verification: verification ? {
      status: verification.status, failure_code: verification.failure_code,
      reported_amount: moneyNumber(verification.reported_amount),
      ...(diagnostic ? { diagnostic } : {}),
    } : null,
  };
}

function createPaymentService({ db, storage, verifier, config, notifier }) {
  const finance = createFinanceService(db);
  async function ownedOrder(query, customerId, orderId, { lock = false } = {}) {
    if (lock) {
      const owner = await query('orders').where({ id: orderId, customer_id: customerId }).first('merchant_id');
      if (owner) await finance.lockMerchant(query, owner.merchant_id);
    }
    let builder = query('orders as o')
      .join('merchants as m', 'm.id', 'o.merchant_id')
      .select(
        'o.id', 'o.order_code', 'o.customer_id', 'o.merchant_id', 'o.status as order_status', 'o.payment_method',
        'o.payment_status', 'o.total_amount', 'm.store_name', 'm.promptpay_identifier_type', 'm.promptpay_id',
        'o.collection_mode', 'o.payment_recipient_version_id',
      )
      .where({ 'o.id': orderId, 'o.customer_id': customerId });
    if (lock) builder = builder.forUpdate('o');
    const order = await builder.first();
    if (!order) throw new HttpError(404, 'order_not_found');
    if (order.collection_mode === 'PLATFORM') {
      const recipient = await finance.recipient(order.payment_recipient_version_id, query);
      order.promptpay_id = recipient.promptpayId;
      order.promptpay_identifier_type = recipient.promptpayType;
      order.financeRecipient = recipient;
    }
    return order;
  }

  async function latestPayment(query, orderId, { lock = false } = {}) {
    let builder = query('payments').where({ order_id: orderId }).orderBy('id', 'desc');
    if (lock) builder = builder.forUpdate();
    return builder.first();
  }

  async function createAttempt(customerId, orderId) {
    const paymentId = await db.transaction(async (trx) => {
      const order = await ownedOrder(trx, customerId, orderId, { lock: true });
      if (order.payment_method !== 'PROMPTPAY') throw new HttpError(409, 'unsupported_payment_method');
      const existing = await latestPayment(trx, order.id, { lock: true });
      if (existing?.status === 'PAID') return existing.id;
      if (order.payment_status === 'PAID') throw new HttpError(409, 'order_already_paid');
      if (['CANCELLED', 'REJECTED', 'COMPLETED'].includes(order.order_status)) throw new HttpError(409, 'order_not_payable');
      // A transport error may retry the SAME stored image without releasing its unique hash.
      if (existing?.status === 'FAILED' && existing.verification_status === 'ERROR') {
        await trx('payments').where({ id: existing.id }).update({ status: 'PENDING', verification_status: 'PENDING', updated_at: trx.fn.now() });
        await trx('orders').where({ id: order.id }).update({ payment_status: 'UNPAID', updated_at: trx.fn.now() });
        return existing.id;
      }
      if (existing && activeStatuses.includes(existing.status)) return existing.id;
      const [created] = await trx('payments').insert({
        order_id: order.id,
        payment_recipient_version_id: order.payment_recipient_version_id,
        method: 'PROMPTPAY',
        status: 'PENDING',
        verification_status: 'PENDING',
        expected_amount: order.total_amount,
        provider: verifier.name,
      }).returning('id');
      if (order.payment_status === 'FAILED') {
        await trx('orders').where({ id: order.id }).update({ payment_status: 'UNPAID', updated_at: trx.fn.now() });
      }
      return created.id;
    });
    return getPayment(customerId, orderId, paymentId);
  }

  async function getPayment(customerId, orderId, expectedPaymentId) {
    await ownedOrder(db, customerId, orderId);
    const payment = expectedPaymentId
      ? await db('payments').where({ id: expectedPaymentId, order_id: orderId }).first()
      : await latestPayment(db, orderId);
    if (!payment) throw new HttpError(404, 'payment_not_found');
    const [slip, verification] = await Promise.all([
      db('payment_slips').where({ payment_id: payment.id }).whereNull('deleted_at').first(),
      db('payment_verifications').where({ payment_id: payment.id }).orderBy('id', 'desc').first(),
    ]);
    return {
      payment: serializePayment(payment, slip, verification),
      verification_mode: config.verificationMode === 'mock' ? 'mock' : undefined,
    };
  }

  async function getQr(customerId, orderId) {
    const order = await ownedOrder(db, customerId, orderId);
    if (order.payment_method !== 'PROMPTPAY') throw new HttpError(409, 'unsupported_payment_method');
    if (order.payment_status === 'PAID') throw new HttpError(409, 'order_already_paid');
    if (['CANCELLED', 'REJECTED', 'COMPLETED'].includes(order.order_status)) throw new HttpError(409, 'order_not_payable');
    const promptpayId = validatePromptPay(order.promptpay_identifier_type, order.promptpay_id);
    const cents = toCents(order.total_amount);
    if (cents === null || cents <= 0) throw new HttpError(422, 'invalid_payment_amount');
    const amount = cents / 100;
    const payload = generatePromptPayPayload(promptpayId, { amount });
    const imageDataUrl = await QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
    return {
      payload,
      image_data_url: imageDataUrl,
      amount,
      merchant: { id: order.merchant_id, store_name: order.store_name, promptpay_identifier: maskIdentifier(promptpayId) },
    };
  }

  function mockInputs(body = {}) {
    if (config.verificationMode !== 'mock') {
      if (body.mockScenario || body.mockTransactionReference) {
        throw new HttpError(400, 'mock_fields_forbidden');
      }
      return {};
    }
    const scenario = body.mockScenario || 'success';
    if (!['success', 'amount_mismatch', 'recipient_mismatch', 'duplicate_reference', 'provider_error', 'invalid_slip'].includes(scenario)) {
      throw new HttpError(400, 'invalid_mock_scenario');
    }
    let transactionReference;
    if (body.mockTransactionReference) {
      transactionReference = String(body.mockTransactionReference).trim();
      if (!/^[A-Za-z0-9_.:-]{4,80}$/.test(transactionReference)) {
        throw new HttpError(400, 'invalid_mock_transaction_reference');
      }
    }
    return { scenario, transactionReference };
  }

  async function markProviderError(customerId, orderId, paymentId, verificationId, error) {
    await db.transaction(async (trx) => {
      await ownedOrder(trx, customerId, orderId, { lock: true });
      const payment = await trx('payments').where({ id: paymentId, order_id: orderId }).forUpdate().first();
      if (!payment || payment.status === 'PAID') return;
      await trx('payment_verifications').where({ id: verificationId, payment_id: paymentId }).update({
        status: 'ERROR',
        failure_code: error.code || 'provider_error',
        provider_request_id: error.providerRequestId || null,
        provider_response: JSON.stringify({
          provider: verifier.name, status: 'ERROR', request_id: error.providerRequestId || null,
          error_code: error.code || 'provider_error', http_status: error.httpStatus || null,
          retryable: error.retryable !== false,
          verification_stage: 'PROVIDER', failure_code: error.code || 'provider_error',
        }),
      });
      await trx('payments').where({ id: paymentId }).update({ status: 'FAILED', verification_status: 'ERROR', updated_at: trx.fn.now() });
      await trx('orders').where({ id: orderId }).update({ payment_status: 'FAILED', updated_at: trx.fn.now() });
    });
  }

  async function markDuplicate(customerId, orderId, paymentId, verificationId, result) {
    await db.transaction(async (trx) => {
      await ownedOrder(trx, customerId, orderId, { lock: true });
      const payment = await trx('payments').where({ id: paymentId, order_id: orderId }).forUpdate().first();
      if (!payment || payment.status === 'PAID') return;
      await trx('payment_verifications').where({ id: verificationId, payment_id: paymentId }).update({
        status: 'REJECTED', failure_code: 'DUPLICATE_TRANSACTION_REFERENCE',
        provider_transaction_reference: result.transactionReference,
        reported_amount: result.amount,
        amount_matches: toCents(result.amount) === toCents(payment.expected_amount),
        recipient_matches: true,
        provider_response: JSON.stringify(result.rawRedacted),
      });
      await trx('payments').where({ id: paymentId }).update({ status: 'FAILED', verification_status: 'REJECTED', updated_at: trx.fn.now() });
      await trx('orders').where({ id: orderId }).update({ payment_status: 'FAILED', updated_at: trx.fn.now() });
    });
  }

  function evaluateProviderResult(order, payment, result) {
    const reference = String(result.transactionReference || '').trim();
    const amountMatches = result.amount !== null && result.amount !== undefined
      && toCents(result.amount) !== null
      && toCents(result.amount) === toCents(payment.expected_amount);
    const recipientMatches = Boolean(result.recipient?.value)
      && identifiersMatch(result.recipient.value, order.promptpay_id)
      && recipientTypeMatches(result.recipient.type, order.promptpay_identifier_type)
      && (verifier.name !== 'easyslip-v2' || (result.recipientVerified === true && result.merchantId === order.merchant_id));
    let failureCode = result.status !== 'VERIFIED' ? (result.failureCode || 'PROVIDER_REJECTED') : null;
    if (!failureCode && !/^[A-Za-z0-9_.:-]{1,255}$/.test(reference)) failureCode = 'MISSING_TRANSACTION_REFERENCE';
    else if (!failureCode && ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(order.order_status)) failureCode = 'ORDER_NOT_PAYABLE';
    else if (!failureCode && !amountMatches) failureCode = 'AMOUNT_MISMATCH';
    else if (!failureCode && !recipientMatches) failureCode = 'RECIPIENT_MISMATCH';
    const verificationStage = ['INVALID_IMAGE_FORMAT', 'INVALID_IMAGE_TYPE', 'IMAGE_SIZE_TOO_LARGE'].includes(failureCode) ? 'UPLOAD'
      : failureCode === 'AMOUNT_MISMATCH' ? 'AMOUNT'
        : failureCode === 'RECIPIENT_MISMATCH' ? 'RECIPIENT'
          : failureCode === 'DUPLICATE_TRANSACTION_REFERENCE' ? 'DUPLICATE'
            : failureCode ? 'PROVIDER' : 'FINALIZE';
    return { reference, amountMatches, recipientMatches, failureCode, verificationStage };
  }

  async function stageProviderResult(customerId, orderId, paymentId, verificationId, result, { reconciliation = false } = {}) {
    return db.transaction(async (trx) => {
      const order = await ownedOrder(trx, customerId, orderId, { lock: true });
      const payment = await trx('payments').where({ id: paymentId, order_id: orderId }).forUpdate().first();
      if (!payment) throw new HttpError(404, 'payment_not_found');
      if (payment.status === 'PAID' || payment.verification_status === 'VERIFIED') return { ready: false, paid: true };
      const verification = await trx('payment_verifications').where({ id: verificationId, payment_id: payment.id }).forUpdate().first();
      if (!verification) throw new HttpError(404, 'payment_verification_not_found');
      const evaluated = evaluateProviderResult(order, payment, result);
      const duplicate = evaluated.reference
        ? await trx('payments').where({ transaction_reference: evaluated.reference }).whereNot({ id: payment.id }).first('id')
        : null;
      const priorSamePayment = result.providerDuplicate === true && evaluated.reference
        ? await trx('payment_verifications').where({ payment_id: payment.id })
          .whereNot({ id: verification.id }).where({
            provider_transaction_reference: evaluated.reference,
            amount_matches: true,
            recipient_matches: true,
          }).whereNull('failure_code').first('id')
        : null;
      if (!evaluated.failureCode && (duplicate || (result.providerDuplicate === true && !priorSamePayment))) {
        evaluated.failureCode = result.providerDuplicate === true && reconciliation
          ? 'PROVIDER_DUPLICATE_REQUIRES_REVIEW' : 'DUPLICATE_TRANSACTION_REFERENCE';
        evaluated.verificationStage = 'DUPLICATE';
      }
      const now = trx.fn.now();
      await trx('payment_verifications').where({ id: verificationId, payment_id: payment.id }).update({
        provider_request_id: result.providerRequestId,
        status: evaluated.failureCode ? 'REJECTED' : 'PROCESSING',
        failure_code: evaluated.failureCode,
        provider_transaction_reference: evaluated.reference || null,
        reported_amount: result.amount,
        amount_matches: evaluated.amountMatches,
        recipient_matches: evaluated.recipientMatches,
        provider_response: JSON.stringify({
          ...result.rawRedacted,
          verification_stage: evaluated.verificationStage,
          failure_code: evaluated.failureCode,
          finalization_pending: !evaluated.failureCode,
        }),
        verified_at: null,
      });
      if (evaluated.failureCode) {
        await trx('payments').where({ id: payment.id }).update({ status: 'FAILED', verification_status: 'REJECTED', updated_at: now });
        await trx('orders').where({ id: order.id }).update({ payment_status: 'FAILED', updated_at: now });
        return { ready: false, paid: false };
      }
      return { ready: true, paid: false };
    });
  }

  function stagedResult(verification) {
    let rawRedacted = {};
    try {
      rawRedacted = typeof verification.provider_response === 'string'
        ? JSON.parse(verification.provider_response) : (verification.provider_response || {});
    } catch { /* The normalized columns remain authoritative for finalization. */ }
    return {
      status: 'VERIFIED',
      transactionReference: verification.provider_transaction_reference,
      amount: moneyNumber(verification.reported_amount),
      providerRequestId: verification.provider_request_id,
      rawRedacted,
    };
  }

  async function finalizeStaged(customerId, orderId, paymentId, verificationId) {
    let resultForConflict;
    try {
      return await db.transaction(async (trx) => {
        const order = await ownedOrder(trx, customerId, orderId, { lock: true });
        const payment = await trx('payments').where({ id: paymentId, order_id: orderId }).forUpdate().first();
        if (!payment) throw new HttpError(404, 'payment_not_found');
        if (payment.status === 'PAID' || payment.verification_status === 'VERIFIED') {
          return { verified: false, queued: true };
        }
        const verification = await trx('payment_verifications').where({ id: verificationId, payment_id: payment.id }).forUpdate().first();
        if (!verification) throw new HttpError(404, 'payment_verification_not_found');
        const reference = String(verification.provider_transaction_reference || '').trim();
        const amountMatches = verification.amount_matches === true
          && toCents(verification.reported_amount) === toCents(payment.expected_amount);
        const recipientMatches = verification.recipient_matches === true;
        const duplicate = reference ? await trx('payments').where({ transaction_reference: reference }).whereNot({ id: payment.id }).first('id') : null;
        let failureCode = verification.status !== 'PROCESSING' || verification.failure_code ? 'PAYMENT_RECONCILIATION_INVALID' : null;
        if (!failureCode && !/^[A-Za-z0-9_.:-]{1,255}$/.test(reference)) failureCode = 'MISSING_TRANSACTION_REFERENCE';
        else if (!failureCode && ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(order.order_status)) failureCode = 'ORDER_NOT_PAYABLE';
        else if (!failureCode && duplicate) failureCode = 'DUPLICATE_TRANSACTION_REFERENCE';
        else if (!failureCode && !amountMatches) failureCode = 'AMOUNT_MISMATCH';
        else if (!failureCode && !recipientMatches) failureCode = 'RECIPIENT_MISMATCH';
        resultForConflict = stagedResult(verification);
        const now = trx.fn.now();
        await trx('payment_verifications').where({ id: verificationId, payment_id: payment.id }).update({
          status: failureCode ? 'REJECTED' : 'VERIFIED',
          failure_code: failureCode,
          verified_at: failureCode ? null : now,
        });
        if (failureCode) {
          await trx('payments').where({ id: payment.id }).update({ status: 'FAILED', verification_status: 'REJECTED', updated_at: now });
          await trx('orders').where({ id: order.id }).update({ payment_status: 'FAILED', updated_at: now });
          return { verified: false, queued: false };
        }
        await trx('payments').where({ id: payment.id }).update({
          status: 'PAID', verification_status: 'VERIFIED', amount_transferred: verification.reported_amount,
          transaction_reference: reference, verified_at: now, paid_at: now, updated_at: now,
        });
        await trx('orders').where({ id: order.id }).update({ payment_status: 'PAID', updated_at: now });
        await finance.capture(trx, order.id, payment.id);
        const queued = await enqueueNotification(notifier, trx, 'PAYMENT_VERIFIED', order.id);
        return { verified: true, queued };
      });
    } catch (error) {
      if (error.code === '23505' && ['payments_transaction_reference_unique', 'payments_one_paid_per_order'].includes(error.constraint)) {
        await markDuplicate(customerId, orderId, paymentId, verificationId, resultForConflict || {});
        return { verified: false, queued: false };
      }
      throw error;
    }
  }

  async function finalize(customerId, orderId, paymentId, verificationId, result, options) {
    const staged = await stageProviderResult(customerId, orderId, paymentId, verificationId, result, options);
    if (!staged.ready) return { verified: false, queued: staged.paid };
    return finalizeStaged(customerId, orderId, paymentId, verificationId);
  }

  async function uploadAndVerify(customerId, orderId, file, body) {
    if (!file) throw new HttpError(400, 'slip_required');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      throw new HttpError(415, 'unsupported_slip_image');
    }
    if (!file.buffer?.length || file.buffer.length > Math.min(config.maxUploadBytes, 4194304)) throw new HttpError(413, 'slip_too_large');
    const inputs = mockInputs(body);
    const initial = await db.transaction(async (trx) => {
      const order = await ownedOrder(trx, customerId, orderId, { lock: true });
      const payment = await latestPayment(trx, orderId, { lock: true });
      if (payment?.status === 'PAID') return { order, payment, paid: true };
      if (order.payment_status === 'PAID') throw new HttpError(409, 'order_already_paid');
      if (order.payment_method !== 'PROMPTPAY' || ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(order.order_status)) throw new HttpError(409, 'order_not_payable');
      if (!payment) throw new HttpError(409, 'payment_attempt_required');
      if (payment.status !== 'PENDING' || payment.verification_status !== 'PENDING') {
        throw new HttpError(409, payment.status === 'PAID' ? 'payment_already_verified' : 'new_payment_attempt_required');
      }
      return { order, payment };
    });
    if (initial.paid) return getPayment(customerId, orderId, initial.payment.id);
    try {
      verifier.preflight?.({ financeRecipient: initial.order.financeRecipient, merchantId: initial.order.merchant_id, expectedRecipient: initial.order.promptpay_id,
        expectedRecipientType: initial.order.promptpay_identifier_type });
    } catch { throw new HttpError(503, 'payment_recipient_not_configured', 'ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน'); }

    let stored;
    try {
      stored = await storage.put({ paymentId: initial.payment.id, buffer: file.buffer, contentType: file.mimetype });
    } catch (error) {
      if (error.code === 'unsupported_slip_image') throw new HttpError(415, 'unsupported_slip_image');
      throw error;
    }

    let verificationId;
    try {
      verificationId = await db.transaction(async (trx) => {
        const order = await ownedOrder(trx, customerId, orderId, { lock: true });
        const payment = await trx('payments').where({ id: initial.payment.id, order_id: orderId }).forUpdate().first();
        if (!payment || payment.status !== 'PENDING' || payment.verification_status !== 'PENDING') {
          throw new HttpError(409, 'payment_verification_in_progress');
        }
        const existingSlip = await trx('payment_slips').where({ payment_id: payment.id }).first();
        if (existingSlip && existingSlip.file_hash !== stored.fileHash) throw new HttpError(409, 'retry_original_slip_required');
        const purgeAfter = new Date(Date.now() + config.retentionHours * 60 * 60 * 1000);
        if (!existingSlip) await trx('payment_slips').insert({
          payment_id: payment.id, object_key: stored.objectKey, file_hash: stored.fileHash, purge_after: purgeAfter,
        });
        const [verification] = await trx('payment_verifications').insert({
          payment_id: payment.id, provider: verifier.name, status: 'PROCESSING',
          provider_response: JSON.stringify({}), response_purge_after: purgeAfter,
        }).returning('id');
        await trx('payments').where({ id: payment.id }).update({
          status: 'PROCESSING', verification_status: 'PROCESSING', provider: verifier.name, updated_at: trx.fn.now(),
        });
        await trx('orders').where({ id: order.id }).update({ payment_status: 'PENDING_VERIFICATION', updated_at: trx.fn.now() });
        return verification.id;
      });
    } catch (error) {
      await storage.remove(stored.objectKey).catch(() => {});
      if (error.code === '23505' && error.constraint?.includes('file_hash')) throw new HttpError(409, 'duplicate_slip');
      throw error;
    }
    const retainedSlip = await db('payment_slips').where({ payment_id: initial.payment.id }).first('object_key');
    if (retainedSlip.object_key !== stored.objectKey) await storage.remove(stored.objectKey).catch(() => {});

    let result;
    try {
      result = await verifier.verify({
        financeRecipient: initial.order.financeRecipient,
        paymentId: initial.payment.id,
        orderId,
        orderCode: initial.order.order_code,
        merchantId: initial.order.merchant_id,
        expectedAmount: Number(initial.payment.expected_amount),
        expectedRecipient: initial.order.promptpay_id,
        expectedRecipientType: initial.order.promptpay_identifier_type,
        fileHash: stored.fileHash,
        fileBuffer: file.buffer,
        contentType: file.mimetype,
        ...inputs,
      });
    } catch (error) {
      if (!(error instanceof VerificationProviderError)) throw error;
      await markProviderError(customerId, orderId, initial.payment.id, verificationId, error);
      return getPayment(customerId, orderId, initial.payment.id);
    }
    const finalized = await finalize(customerId, orderId, initial.payment.id, verificationId, result);
    if (finalized.verified && !finalized.queued) await notifySafely(notifier, 'PAYMENT_VERIFIED', orderId);
    return getPayment(customerId, orderId, initial.payment.id);
  }

  async function reconcilePayment(customerId, orderId) {
    const prepared = await db.transaction(async (trx) => {
      const order = await ownedOrder(trx, customerId, orderId, { lock: true });
      const payment = await latestPayment(trx, orderId, { lock: true });
      if (!payment) throw new HttpError(404, 'payment_not_found');
      if (payment.status === 'PAID' || payment.verification_status === 'VERIFIED' || order.payment_status === 'PAID') {
        return { mode: 'paid', paymentId: payment.id };
      }
      if (order.payment_method !== 'PROMPTPAY' || ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(order.order_status)) {
        throw new HttpError(409, 'order_not_payable');
      }
      const slip = await trx('payment_slips').where({ payment_id: payment.id }).whereNull('deleted_at').forUpdate().first();
      const verification = await trx('payment_verifications').where({ payment_id: payment.id }).orderBy('id', 'desc').forUpdate().first();
      if (!slip) throw new HttpError(409, 'payment_reconciliation_unavailable');
      const hasStagedResult = verification?.status === 'PROCESSING'
        && Boolean(verification.provider_transaction_reference)
        && verification.reported_amount !== null
        && verification.reported_amount !== undefined
        && verification.amount_matches === true
        && verification.recipient_matches === true
        && !verification.failure_code;
      if (hasStagedResult) {
        return { mode: 'finalize', paymentId: payment.id, verificationId: verification.id };
      }
      if (verification?.status === 'REJECTED' || payment.verification_status === 'REJECTED') {
        throw new HttpError(409, 'payment_reconciliation_unavailable');
      }
      const processingStartedAt = new Date(payment.updated_at || verification?.created_at || 0).getTime();
      const recentlyProcessing = (payment.status === 'PROCESSING' || verification?.status === 'PROCESSING')
        && Number.isFinite(processingStartedAt)
        && Date.now() - processingStartedAt < 90000;
      if (recentlyProcessing) return { mode: 'wait', paymentId: payment.id };
      try {
        verifier.preflight?.({
          financeRecipient: order.financeRecipient,
          merchantId: order.merchant_id,
          expectedRecipient: order.promptpay_id,
          expectedRecipientType: order.promptpay_identifier_type,
        });
      } catch {
        throw new HttpError(503, 'payment_recipient_not_configured', 'ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน');
      }
      if (verification?.status === 'PROCESSING') {
        await trx('payment_verifications').where({ id: verification.id }).update({
          status: 'ERROR',
          failure_code: 'PAYMENT_RECONCILIATION_STALE',
          provider_response: JSON.stringify({
            provider: verifier.name,
            status: 'ERROR',
            error_code: 'PAYMENT_RECONCILIATION_STALE',
            verification_stage: 'PROVIDER',
            failure_code: 'PAYMENT_RECONCILIATION_STALE',
          }),
        });
      }
      const [created] = await trx('payment_verifications').insert({
        payment_id: payment.id,
        provider: verifier.name,
        status: 'PROCESSING',
        provider_response: JSON.stringify({ verification_stage: 'PROVIDER', reconciliation: true }),
        response_purge_after: slip.purge_after,
      }).returning('id');
      await trx('payments').where({ id: payment.id }).update({
        status: 'PROCESSING', verification_status: 'PROCESSING', provider: verifier.name, updated_at: trx.fn.now(),
      });
      await trx('orders').where({ id: order.id }).update({ payment_status: 'PENDING_VERIFICATION', updated_at: trx.fn.now() });
      return { mode: 'provider', order, payment, slip, verificationId: created.id };
    });

    if (prepared.mode === 'paid' || prepared.mode === 'wait') {
      return getPayment(customerId, orderId, prepared.paymentId);
    }
    if (prepared.mode === 'finalize') {
      const finalized = await finalizeStaged(customerId, orderId, prepared.paymentId, prepared.verificationId);
      if (finalized.verified && !finalized.queued) await notifySafely(notifier, 'PAYMENT_VERIFIED', orderId);
      return getPayment(customerId, orderId, prepared.paymentId);
    }

    let stored;
    try {
      stored = await storage.read(prepared.slip.object_key);
      const hash = crypto.createHash('sha256').update(stored.buffer).digest('hex');
      if (hash !== prepared.slip.file_hash
        || !['image/png', 'image/jpeg', 'image/webp'].includes(stored.contentType)
        || !stored.buffer.length
        || stored.buffer.length > Math.min(config.maxUploadBytes, 4194304)) {
        throw new VerificationProviderError('STORED_SLIP_INTEGRITY_ERROR', { retryable: false });
      }
    } catch (error) {
      const providerError = error instanceof VerificationProviderError
        ? error : new VerificationProviderError('STORED_SLIP_UNAVAILABLE');
      await markProviderError(customerId, orderId, prepared.payment.id, prepared.verificationId, providerError);
      return getPayment(customerId, orderId, prepared.payment.id);
    }

    let result;
    try {
      result = await verifier.verify({
        financeRecipient: prepared.order.financeRecipient,
        paymentId: prepared.payment.id,
        orderId,
        orderCode: prepared.order.order_code,
        merchantId: prepared.order.merchant_id,
        expectedAmount: Number(prepared.payment.expected_amount),
        expectedRecipient: prepared.order.promptpay_id,
        expectedRecipientType: prepared.order.promptpay_identifier_type,
        fileHash: prepared.slip.file_hash,
        fileBuffer: stored.buffer,
        contentType: stored.contentType,
        ...mockInputs({}),
      });
    } catch (error) {
      if (!(error instanceof VerificationProviderError)) throw error;
      await markProviderError(customerId, orderId, prepared.payment.id, prepared.verificationId, error);
      return getPayment(customerId, orderId, prepared.payment.id);
    }
    const finalized = await finalize(customerId, orderId, prepared.payment.id, prepared.verificationId, result, { reconciliation: true });
    if (finalized.verified && !finalized.queued) await notifySafely(notifier, 'PAYMENT_VERIFIED', orderId);
    return getPayment(customerId, orderId, prepared.payment.id);
  }

  return {
    maxUploadBytes: config.maxUploadBytes,
    slipMaxUploadBytes: Math.min(config.maxUploadBytes, 4194304),
    createAttempt,
    getPayment,
    getQr,
    uploadAndVerify,
    reconcilePayment,
  };
}

module.exports = { createPaymentService, maskIdentifier, validatePromptPay };
