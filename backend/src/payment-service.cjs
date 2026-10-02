const generatePromptPayPayload = require('promptpay-qr');
const QRCode = require('qrcode');
const { HttpError } = require('./http.cjs');
const { VerificationProviderError, identifiersMatch, normalizeIdentifier } = require('./payment-verifier.cjs');
const { notifySafely } = require('./line-order-notifier.cjs');
const { enqueueNotification } = require('./notification-outbox.cjs');

const activeStatuses = ['PENDING', 'SUBMITTED', 'PROCESSING'];
const moneyNumber = (value) => value === null || value === undefined ? null : Number(value);
const toCents = (value) => Math.round(Number(value) * 100);

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
  return {
    ...payment,
    expected_amount: moneyNumber(payment.expected_amount),
    amount_transferred: moneyNumber(payment.amount_transferred),
    slip: slip ? {
      id: slip.id,
      object_key: slip.object_key,
      uploaded_at: slip.uploaded_at,
      purge_after: slip.purge_after,
    } : null,
    verification: verification ? {
      ...verification,
      reported_amount: moneyNumber(verification.reported_amount),
    } : null,
  };
}

function createPaymentService({ db, storage, verifier, config, notifier }) {
  async function ownedOrder(query, customerId, orderId, { lock = false } = {}) {
    let builder = query('orders as o')
      .join('merchants as m', 'm.id', 'o.merchant_id')
      .select(
        'o.id', 'o.customer_id', 'o.merchant_id', 'o.status as order_status', 'o.payment_method',
        'o.payment_status', 'o.total_amount', 'm.store_name', 'm.promptpay_identifier_type', 'm.promptpay_id',
      )
      .where({ 'o.id': orderId, 'o.customer_id': customerId });
    if (lock) builder = builder.forUpdate('o');
    const order = await builder.first();
    if (!order) throw new HttpError(404, 'order_not_found');
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
      if (order.payment_status === 'PAID') throw new HttpError(409, 'order_already_paid');
      const existing = await latestPayment(trx, order.id, { lock: true });
      if (existing?.status === 'PAID') throw new HttpError(409, 'order_already_paid');
      if (existing && activeStatuses.includes(existing.status)) return existing.id;
      const [created] = await trx('payments').insert({
        order_id: order.id,
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
    const promptpayId = validatePromptPay(order.promptpay_identifier_type, order.promptpay_id);
    const amount = Number(order.total_amount);
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
    if (!['success', 'amount_mismatch', 'recipient_mismatch', 'duplicate_reference', 'provider_error'].includes(scenario)) {
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
          error_code: error.code || 'provider_error',
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

  async function finalize(customerId, orderId, paymentId, verificationId, result) {
    try {
      return await db.transaction(async (trx) => {
        const order = await ownedOrder(trx, customerId, orderId, { lock: true });
        const payment = await trx('payments').where({ id: paymentId, order_id: orderId }).forUpdate().first();
        if (!payment) throw new HttpError(404, 'payment_not_found');
        if (payment.status === 'PAID' || payment.verification_status === 'VERIFIED') {
          throw new HttpError(409, 'payment_already_verified');
        }
        const reference = String(result.transactionReference || '').trim();
        const amountMatches = result.amount !== null && result.amount !== undefined
          && toCents(result.amount) === toCents(payment.expected_amount);
        const recipientMatches = Boolean(result.recipient?.value)
          && identifiersMatch(result.recipient.value, order.promptpay_id)
          && recipientTypeMatches(result.recipient.type, order.promptpay_identifier_type);
        const duplicate = reference ? await trx('payments').where({ transaction_reference: reference }).whereNot({ id: payment.id }).first('id') : null;
        let failureCode = result.status === 'REJECTED' ? (result.failureCode || 'PROVIDER_REJECTED') : null;
        if (!failureCode && !reference) failureCode = 'MISSING_TRANSACTION_REFERENCE';
        else if (!failureCode && duplicate) failureCode = 'DUPLICATE_TRANSACTION_REFERENCE';
        else if (!failureCode && !amountMatches) failureCode = 'AMOUNT_MISMATCH';
        else if (!failureCode && !recipientMatches) failureCode = 'RECIPIENT_MISMATCH';
        const status = failureCode ? 'REJECTED' : 'VERIFIED';
        const now = trx.fn.now();
        await trx('payment_verifications').where({ id: verificationId, payment_id: payment.id }).update({
          provider_request_id: result.providerRequestId,
          status,
          failure_code: failureCode,
          provider_transaction_reference: reference || null,
          reported_amount: result.amount,
          amount_matches: amountMatches,
          recipient_matches: recipientMatches,
          provider_response: JSON.stringify(result.rawRedacted),
          verified_at: failureCode ? null : now,
        });
        if (failureCode) {
          await trx('payments').where({ id: payment.id }).update({ status: 'FAILED', verification_status: 'REJECTED', updated_at: now });
          await trx('orders').where({ id: order.id }).update({ payment_status: 'FAILED', updated_at: now });
          return { verified: false, queued: false };
        }
        await trx('payments').where({ id: payment.id }).update({
          status: 'PAID', verification_status: 'VERIFIED', amount_transferred: result.amount,
          transaction_reference: reference, verified_at: now, paid_at: now, updated_at: now,
        });
        await trx('orders').where({ id: order.id }).update({ payment_status: 'PAID', updated_at: now });
        const queued = await enqueueNotification(notifier, trx, 'PAYMENT_VERIFIED', order.id);
        return { verified: true, queued };
      });
    } catch (error) {
      if (error.code === '23505' && ['payments_transaction_reference_unique', 'payments_one_paid_per_order'].includes(error.constraint)) {
        await markDuplicate(customerId, orderId, paymentId, verificationId, result);
        return { verified: false, queued: false };
      }
      throw error;
    }
  }

  async function uploadAndVerify(customerId, orderId, file, body) {
    if (!file) throw new HttpError(400, 'slip_required');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      throw new HttpError(415, 'unsupported_slip_image');
    }
    const inputs = mockInputs(body);
    const initial = await db.transaction(async (trx) => {
      const order = await ownedOrder(trx, customerId, orderId, { lock: true });
      if (order.payment_status === 'PAID') throw new HttpError(409, 'order_already_paid');
      const payment = await latestPayment(trx, orderId, { lock: true });
      if (!payment) throw new HttpError(409, 'payment_attempt_required');
      if (payment.status !== 'PENDING' || payment.verification_status !== 'PENDING') {
        throw new HttpError(409, payment.status === 'PAID' ? 'payment_already_verified' : 'new_payment_attempt_required');
      }
      return { order, payment };
    });

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
        const existingSlip = await trx('payment_slips').where({ payment_id: payment.id }).first('id');
        if (existingSlip) throw new HttpError(409, 'slip_already_uploaded');
        const purgeAfter = new Date(Date.now() + config.retentionHours * 60 * 60 * 1000);
        await trx('payment_slips').insert({
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

    let result;
    try {
      result = await verifier.verify({
        paymentId: initial.payment.id,
        orderId,
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

  return { maxUploadBytes: config.maxUploadBytes, createAttempt, getPayment, getQr, uploadAndVerify };
}

module.exports = { createPaymentService, maskIdentifier, validatePromptPay };
