const crypto = require('node:crypto');
const { HttpError } = require('./http.cjs');
const { allocation, refundAllocation, integer, reference, served } = require('./finance-money.cjs');
const { createIntegrationCrypto } = require('./integration-crypto.cjs');
const { resolveIntegrationKey } = require('./integration-key.cjs');
const { createAdminAudit } = require('./admin-audit.cjs');

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = () => crypto.randomUUID();
const fail = (code, message = 'ไม่สามารถดำเนินรายการการเงินนี้ได้') => { throw new HttpError(409, code, message); };
const min = (a, b) => a < b ? a : b;
const masked = value => `******${value.slice(-4)}`;
function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(value)) throw new HttpError(400, 'finance_idempotency_key_required');
  return value;
}
function manager(actor) { if (actor?.role !== 'MANAGER') throw new HttpError(403, 'finance_manager_required'); }
function admin(actor) { if (!['SUPER_ADMIN', 'FINANCE'].includes(actor?.role)) throw new HttpError(403, 'finance_permission_denied'); }
function owner(actor) { if (actor?.role !== 'SUPER_ADMIN') throw new HttpError(403, 'finance_owner_required'); }

function createFinanceService(db, { encryption, env = process.env, audit = createAdminAudit(db), integrations, storage } = {}) {
  let cipher = encryption;
  const crypt = () => { cipher ||= createIntegrationCrypto(resolveIntegrationKey(env).encoded); return cipher; };
  const runtime = async (q = db, lock = false) => {
    let query = q('system_settings').where({ setting_key: 'finance.runtime' });
    if (lock) query = query.forShare();
    return (await query.first())?.setting_value || { mode: 'LEGACY_MERCHANT_DIRECT' };
  };
  const now = async q => (await q.raw('SELECT clock_timestamp() AS now')).rows[0].now;
  async function lockMerchant(q, merchantId) {
    const merchant = await q('merchants').where({ id: merchantId }).forUpdate().first();
    if (!merchant) throw new HttpError(404, 'merchant_not_found');
    return merchant;
  }
  async function log(q, actor, action, entity, entityId, metadata = {}) {
    await audit.append({ actorType: actor?.role === 'MANAGER' ? 'MERCHANT_STAFF' : actor ? 'ADMIN' : 'SYSTEM',
      actorId: actor?.id || null, action, entityType: entity, entityId, metadata }, q);
  }
  async function balances(merchantId, q = db) {
    const rows = await q('financial_accounts as a').leftJoin('financial_postings as p', 'a.id', 'p.account_id')
      .where('a.merchant_id', merchantId).groupBy('a.kind').select('a.kind')
      .select(q.raw("coalesce(sum(CASE WHEN (a.kind='MERCHANT_DEBT' AND p.side='D') OR (a.kind<>'MERCHANT_DEBT' AND p.side='C') THEN p.amount_satang ELSE -p.amount_satang END),0)::text AS balance"));
    const result = Object.fromEntries(['PENDING','AVAILABLE','RESERVED','HELD','DEBT'].map(k => [k, '0']));
    for (const r of rows) result[r.kind.replace('MERCHANT_', '')] = r.balance;
    return result;
  }
  async function post(q, merchantId, eventKey, kind, source, lines) {
    lines = lines.filter(line => BigInt(line[2]) > 0n).map(([kind, side, amount]) => [kind, side, String(amount)]);
    const fingerprint = hash({ kind, source, lines });
    const existing = await q('financial_transactions').where({ event_key: eventKey }).first();
    if (existing) { if (existing.fingerprint !== fingerprint) fail('finance_event_conflict'); return existing; }
    if (lines.length < 2 || lines.reduce((s, l) => s + BigInt(l[2]) * (l[1] === 'D' ? 1n : -1n), 0n) !== 0n) fail('finance_unbalanced');
    const [journal] = await q('financial_transactions').insert({ merchant_id: merchantId, event_key: eventKey, fingerprint, kind, ...source }).returning('*');
    for (const [i, [accountKind, side, amount]] of lines.entries()) {
      const identity = { merchant_id: accountKind.startsWith('MERCHANT_') ? merchantId : null, kind: accountKind };
      await q('financial_accounts').insert(identity).onConflict(['merchant_id','kind']).ignore();
      const account = await q('financial_accounts').where(identity).first();
      await q('financial_postings').insert({ transaction_id: journal.id, line_no: i + 1, account_id: account.id, side, amount_satang: amount });
    }
    return journal;
  }
  async function creditAvailable(q, merchantId, amount) {
    const b = await balances(merchantId, q), offset = min(amount, BigInt(b.DEBT));
    return [['MERCHANT_DEBT','C',offset],['MERCHANT_AVAILABLE','C',amount-offset]];
  }
  async function replay(q, table, merchantId, requestKey, fingerprint) {
    const row = await q(table).where({ merchant_id: merchantId, idempotency_key: key(requestKey) }).first();
    if (row && row.fingerprint !== fingerprint) fail('finance_idempotency_conflict', 'รายการเดิมมีข้อมูลต่างกัน กรุณาสร้างรายการใหม่');
    return row;
  }
  async function configure(actor, body) {
    owner(actor);
    if (!['LEGACY_MERCHANT_DIRECT','PLATFORM_CENTRALIZED'].includes(body.mode) || body.confirm !== true) throw new HttpError(400, 'invalid_finance_mode');
    const e = integrations ? await integrations.environment() : env;
    return db.transaction(async q => {
      await q('system_settings').where({ setting_key: 'finance.runtime' }).forUpdate().first();
      const current = await runtime(q);
      let recipientId = current.recipient_version_id, policyId = current.policy_version_id;
      if (body.mode === 'PLATFORM_CENTRALIZED') {
        const type = body.promptpayType || e.PLATFORM_PROMPTPAY_TYPE;
        const value = body.promptpayId || e.PLATFORM_PROMPTPAY_ID;
        const name = body.displayName || e.PLATFORM_PROMPTPAY_NAME;
        const { validatePromptPay } = require('./payment-service.cjs');
        const normalized = validatePromptPay(type, value);
        if (!name || name.length > 120 || !/^\d{3}$/.test(body.bankCode) || !/^\d{6,20}$/.test(body.bankNumber)) throw new HttpError(422, 'platform_recipient_required', 'กรุณาระบุบัญชีรับเงิน Platform ให้ครบ');
        recipientId = id();
        await q('platform_payment_recipients').insert({ id: recipientId, version: recipientId, identity_type: type, display_name: name,
          masked_identity: masked(normalized), encrypted_identity: crypt().encrypt(`finance:recipient:${recipientId}`, JSON.stringify({ promptpayId: normalized, promptpayType: type, bankCode: body.bankCode, bankNumber: body.bankNumber })),
          source_account_key: hash([body.bankCode, body.bankNumber]), created_by_admin_id: actor.id });
        const existing = await q('finance_policy_versions').where({ version: 'FINANCE_V1' }).first();
        policyId = existing?.id || (await q('finance_policy_versions').insert({ version: 'FINANCE_V1', approved_by_admin_id: actor.id }).returning('id'))[0].id;
      }
      const result = { mode: body.mode, recipient_version_id: recipientId, policy_version_id: policyId };
      await q('system_settings').where({ setting_key: 'finance.runtime' }).update({ setting_value: JSON.stringify(result), updated_at: q.fn.now(), updated_by_admin_id: actor.id });
      await log(q, actor, 'FINANCE_MODE_CHANGED', 'FINANCE_RUNTIME', 1, { mode: body.mode, recipient_version_id: recipientId });
      return result;
    });
  }
  async function route(q, order) {
    const config = await runtime(q, true);
    if (config.mode !== 'PLATFORM_CENTRALIZED') return { collection_mode: 'LEGACY_DIRECT', payment_recipient_version_id: null };
    allocation(order);
    return { collection_mode: 'PLATFORM', payment_recipient_version_id: config.recipient_version_id };
  }
  async function recipient(versionId, q = db) {
    const version = await q('platform_payment_recipients').where({ id: versionId }).first();
    if (!version) fail('finance_recipient_missing');
    return { ...JSON.parse(crypt().decrypt(`finance:recipient:${version.id}`, version.encrypted_identity)), versionId: version.id };
  }
  async function capture(q, orderId, paymentId) {
    const order = await q('orders').where({ id: orderId }).first();
    if (order.collection_mode !== 'PLATFORM') return;
    if (await q('financial_transactions').where({ event_key: `ORDER_PAID:${orderId}` }).first()) return;
    await lockMerchant(q, order.merchant_id);
    if (await q('financial_transactions').where({ event_key: `ORDER_PAID:${orderId}` }).first()) return;
    const payment = await q('payments').where({ id: paymentId, order_id: orderId, status: 'PAID' }).first();
    if (!payment || payment.payment_recipient_version_id !== order.payment_recipient_version_id) fail('finance_payment_mismatch');
    const amounts = allocation(order), config = await runtime(q);
    await q('order_financial_snapshots').insert({ ...amounts, order_id: orderId, merchant_id: order.merchant_id,
      paid_payment_id: paymentId, recipient_version_id: order.payment_recipient_version_id, policy_version_id: config.policy_version_id, paid_at: payment.paid_at });
    await post(q, order.merchant_id, `ORDER_PAID:${orderId}`, 'ORDER_PAID', { order_id: orderId }, [
      ['CASH_CLEARING','D',amounts.customer_paid_satang], ['SUBSIDY_EXPENSE','D',amounts.platform_subsidy_satang],
      ['MERCHANT_PENDING','C',amounts.merchant_entitlement_satang], ['COMMISSION_DEFERRED','C',amounts.commission_satang],
    ]);
  }
  async function refundTotals(q, orderId) {
    const columns = ['food_satang','delivery_satang','merchant_food_discount_satang','merchant_delivery_discount_satang','platform_food_discount_satang','platform_delivery_discount_satang','commission_satang','subsidy_satang','merchant_recovery_satang','customer_refund_satang'];
    const rows = await q('finance_refunds').where({ order_id: orderId });
    return Object.fromEntries(columns.map(c => [c, String(rows.reduce((sum, row) => sum + BigInt(row[c]), 0n))]));
  }
  async function orderEvent(q, orderId, status) {
    const snapshot = await q('order_financial_snapshots').where({ order_id: orderId }).first();
    if (!snapshot) return;
    const kind = status === 'COMPLETED' ? 'ORDER_COMPLETED' : 'ORDER_HELD';
    if (await q('financial_transactions').where({ event_key: `${kind}:${orderId}` }).first()) return;
    await lockMerchant(q, snapshot.merchant_id);
    if (await q('financial_transactions').where({ event_key: `${kind}:${orderId}` }).first()) return;
    const totals = await refundTotals(q, orderId);
    const amount = BigInt(snapshot.merchant_entitlement_satang) - BigInt(totals.merchant_recovery_satang);
    const commission = BigInt(snapshot.commission_satang) - BigInt(totals.commission_satang);
    const lines = [['MERCHANT_PENDING','D',amount]];
    if (status === 'COMPLETED') lines.push(...await creditAvailable(q, snapshot.merchant_id, amount), ['COMMISSION_DEFERRED','D',commission], ['COMMISSION_REVENUE','C',commission]);
    else lines.push(['MERCHANT_HELD','C',amount]);
    if (amount || (status === 'COMPLETED' && commission)) await post(q, snapshot.merchant_id, `${kind}:${orderId}`, kind, { order_id: orderId }, lines);
  }
  function accountView(row) { if (!row) return null; const { encrypted_account, ...safe } = row; void encrypted_account; return safe; }
  async function saveAccount(actor, body) {
    manager(actor);
    if (!['BANK_ACCOUNT','PROMPTPAY'].includes(body.accountType) || typeof body.identifier !== 'string' || !/^\d{6,20}$/.test(body.identifier) || !/^[A-Za-z0-9_]{2,20}$/.test(body.bankCode) || typeof body.accountName !== 'string' || !body.accountName.trim() || body.accountName.length > 160) throw new HttpError(422, 'invalid_payout_account');
    if (body.accountType === 'BANK_ACCOUNT' && !/^\d{3}$/.test(body.bankCode)) throw new HttpError(422,'invalid_payout_account');
    if (body.accountType === 'PROMPTPAY') require('./payment-service.cjs').validatePromptPay(body.bankCode,body.identifier);
    return db.transaction(async q => {
      await lockMerchant(q, actor.merchant_id);
      const accountId = id();
      const [account] = await q('merchant_payout_accounts').insert({ id: accountId, merchant_id: actor.merchant_id, requested_by_staff_id: actor.id,
        account_type: body.accountType, bank_code: body.bankCode, masked_account: masked(body.identifier),
        encrypted_account: crypt().encrypt(`finance:payout:${accountId}`, JSON.stringify({ identifier: body.identifier, accountName: body.accountName })) }).returning('*');
      await q('merchants').where({ id: actor.merchant_id }).update({ payout_account_changed_at: q.fn.now() });
      await q('merchant_withdrawals').where({ merchant_id: actor.merchant_id }).whereIn('status', ['REQUESTED','APPROVED','PROCESSING']).update({ account_review_required: true });
      await log(q, actor, 'PAYOUT_ACCOUNT_SUBMITTED', 'PAYOUT_ACCOUNT', accountId);
      return accountView(account);
    });
  }
  async function verifyAccount(actor, accountId) {
    owner(actor);
    return db.transaction(async q => {
      let row = await q('merchant_payout_accounts').where({ id: accountId }).first();
      if (!row) throw new HttpError(404, 'payout_account_not_found');
      await lockMerchant(q, row.merchant_id);
      row = await q('merchant_payout_accounts').where({ id: accountId }).forUpdate().first();
      if (row.status !== 'PENDING_VERIFICATION') fail('payout_account_already_reviewed');
      await q('merchant_payout_accounts').where({ merchant_id: row.merchant_id, is_current: true }).update({ is_current: false, status: 'RETIRED' });
      await q('merchant_payout_accounts').where({ id: row.id }).update({ status: 'VERIFIED', is_current: true, verified_at: q.fn.now(), verified_by_admin_id: actor.id });
      await q('merchants').where({ id: row.merchant_id }).update({ payout_account_changed_at: q.fn.now() });
      await log(q, actor, 'PAYOUT_ACCOUNT_VERIFIED', 'PAYOUT_ACCOUNT', row.id);
      return { ok: true };
    });
  }
  async function eligibility(q, merchant) {
    const latest = await q('merchant_withdrawals').where({ merchant_id: merchant.id, status: 'PAID' }).orderBy('paid_at','desc').first();
    const hold = merchant.payout_account_changed_at ? new Date(new Date(merchant.payout_account_changed_at).valueOf()+86400000) : null;
    const cooldown = latest ? new Date(new Date(latest.paid_at).valueOf()+259200000) : null;
    return { account_hold_until: hold, cooldown_until: cooldown,
      next_eligible_at: new Date(Math.max(hold?.valueOf() || 0, cooldown?.valueOf() || 0)).toISOString() };
  }
  async function withdrawal(actor, body, requestKey, automatic = false) {
    manager(actor);
    const amount = integer(body.amountSatang), fingerprint = hash([String(amount)]);
    return db.transaction(async q => {
      const merchant = await lockMerchant(q, actor.merchant_id);
      const previous = await replay(q, 'merchant_withdrawals', merchant.id, requestKey, fingerprint);
      if (previous) return previous;
      if (!merchant.is_active) fail('merchant_suspended');
      if (amount < 30000n) fail('withdrawal_minimum', 'ยอดถอนขั้นต่ำ ฿300');
      const when = await eligibility(q, merchant), clock = await now(q);
      if (clock < new Date(when.next_eligible_at)) fail('withdrawal_on_hold', 'ยังอยู่ในช่วงพักถอนเงิน กรุณาตรวจสอบเวลาที่ถอนได้');
      const account = await q('merchant_payout_accounts').where({ merchant_id: merchant.id, is_current: true, status: 'VERIFIED' }).first();
      if (!account) fail('verified_payout_account_required', 'กรุณาตั้งค่าและยืนยันบัญชีรับเงินก่อน');
      const b = await balances(merchant.id, q);
      if (BigInt(b.DEBT) || BigInt(b.HELD) || BigInt(b.AVAILABLE) < amount) fail('insufficient_available', 'ยอดพร้อมถอนไม่เพียงพอ หรือมีรายการรอตรวจสอบ');
      if (await q('merchant_withdrawals').where({ merchant_id: merchant.id }).whereIn('status',['REQUESTED','APPROVED','PROCESSING']).first()) fail('withdrawal_in_progress', 'มีรายการถอนที่กำลังดำเนินการ');
      const [row] = await q('merchant_withdrawals').insert({ id: id(), merchant_id: merchant.id, payout_account_id: account.id,
        requested_by_staff_id: automatic ? null : actor.id, settlement_window: automatic ? requestKey : null,
        idempotency_key: requestKey, fingerprint, amount_satang: String(amount) }).returning('*');
      await post(q, merchant.id, `WITHDRAWAL_RESERVE:${row.id}`, 'WITHDRAWAL_RESERVE', { withdrawal_id: row.id }, [['MERCHANT_AVAILABLE','D',amount],['MERCHANT_RESERVED','C',amount]]);
      await log(q, automatic ? null : actor, automatic ? 'AUTO_SETTLEMENT_REQUESTED' : 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL', row.id);
      return row;
    });
  }
  async function withdrawalAction(actor, withdrawalId, action, body = {}) {
    if (actor.role === 'MANAGER') { if (action !== 'cancel') throw new HttpError(403, 'finance_permission_denied'); } else admin(actor);
    if (['paid','failed'].includes(action)) owner(actor);
    return db.transaction(async q => {
      let row = await q('merchant_withdrawals').where({ id: withdrawalId }).first();
      if (!row || (actor.role === 'MANAGER' && row.merchant_id !== actor.merchant_id)) throw new HttpError(404, 'withdrawal_not_found');
      const merchant = await lockMerchant(q, row.merchant_id);
      row = await q('merchant_withdrawals').where({ id: row.id }).forUpdate().first();
      const transitions = { approve: ['REQUESTED','APPROVED'], reject: ['REQUESTED','REJECTED'], cancel: ['REQUESTED','CANCELLED'], processing: ['APPROVED','PROCESSING'], paid: ['PROCESSING','PAID'], failed: ['PROCESSING','FAILED'] };
      const transition = transitions[action];
      const canReleaseApproved = ['reject','cancel'].includes(action) && row.status === 'APPROVED';
      if (!transition || (row.status !== transition[0] && !canReleaseApproved)) fail('invalid_withdrawal_transition', 'สถานะรายการเปลี่ยนแล้ว กรุณาโหลดใหม่');
      if (['approve','processing'].includes(action)) {
        if (row.account_review_required) fail('payout_account_changed', 'บัญชีรับเงินมีการเปลี่ยน กรุณายกเลิกรายการที่ยังไม่เริ่มโอนและสร้างใหม่หลังตรวจสอบ');
        if (new Date((await eligibility(q, merchant)).next_eligible_at) > await now(q)) fail('withdrawal_on_hold');
      }
      const changes = { status: transition[1] };
      if (action === 'approve') Object.assign(changes, { reviewed_by_admin_id: actor.id, reviewed_at: q.fn.now() });
      if (action === 'processing') {
        const config = await runtime(q), recipient = await q('platform_payment_recipients').where({ id: config.recipient_version_id }).first();
        if (!recipient) fail('platform_recipient_required');
        await q('finance_transfers').insert({ id: id(), merchant_id: row.merchant_id, withdrawal_id: row.id, recipient_version_id: recipient.id,
          source_account_key: recipient.source_account_key, amount_satang: row.amount_satang, initiated_by_admin_id: actor.id });
      }
      if (action === 'paid') {
        await confirmTransfer(q, actor, { withdrawal_id: row.id }, body);
        Object.assign(changes, { paid_by_admin_id: actor.id, paid_at: q.fn.now() });
        await post(q, row.merchant_id, `WITHDRAWAL_PAID:${row.id}`, 'WITHDRAWAL_PAID', { withdrawal_id: row.id }, [['MERCHANT_RESERVED','D',row.amount_satang],['CASH_CLEARING','C',row.amount_satang]]);
      }
      if (['failed','reject','cancel'].includes(action)) {
        if (!body.reason || body.reason.length > 500) throw new HttpError(422, 'finance_reason_required');
        if (action === 'failed') {
          if (body.confirmNoTransfer !== true) fail('non_transfer_confirmation_required', 'ต้องยืนยันว่าไม่มีการโอนเงินก่อนปล่อยยอดสำรอง');
          await q('finance_transfers').where({ withdrawal_id: row.id, status: 'STARTED' }).update({ status: 'FAILED' });
        }
        changes.reason = body.reason;
        await post(q, row.merchant_id, `WITHDRAWAL_RELEASE:${row.id}`, 'WITHDRAWAL_RELEASE', { withdrawal_id: row.id },
          [['MERCHANT_RESERVED','D',row.amount_satang], ...await creditAvailable(q, row.merchant_id, BigInt(row.amount_satang))]);
      }
      await q('merchant_withdrawals').where({ id: row.id }).update(changes);
      await log(q, actor, `WITHDRAWAL_${transition[1]}`, 'WITHDRAWAL', row.id, { previous_status: row.status });
      return q('merchant_withdrawals').where({ id: row.id }).first();
    });
  }
  async function confirmTransfer(q, actor, source, body) {
    const ref = reference(body.reference);
    const transfer = await q('finance_transfers').where(source).whereIn('status',['STARTED','UNKNOWN']).forUpdate().first();
    if (!transfer) fail('transfer_not_processing');
    // This namespace is pinned by the server at execution start, not supplied by the browser.
    if (await q('finance_transfers').where({ provider: transfer.provider, source_account_key: transfer.source_account_key, external_reference: ref }).first()) fail('duplicate_transfer_reference', 'เลขอ้างอิงนี้ถูกใช้แล้ว กรุณาตรวจสอบรายการโอน');
    if (body.proofKey) {
      if (!/^finance-proofs\/\d{4}\/\d{2}\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(body.proofKey) || !storage?.read) throw new HttpError(422, 'invalid_finance_proof');
      try { await storage.read(body.proofKey); } catch { throw new HttpError(422, 'finance_proof_missing'); }
    }
    try {
      await q('finance_transfers').where({ id: transfer.id }).update({ status: 'CONFIRMED', external_reference: ref, evidence_object_key: body.proofKey || null, confirmed_by_admin_id: actor.id, confirmed_at: q.fn.now() });
    } catch (e) { if (e.constraint === 'finance_bank_reference_uq') fail('duplicate_transfer_reference', 'เลขอ้างอิงนี้ถูกใช้แล้ว กรุณาตรวจสอบรายการโอน'); throw e; }
    await log(q, actor, 'FINANCE_TRANSFER_CONFIRMED', 'FINANCE_TRANSFER', transfer.id, { reference_digest: hash(ref) });
  }
  async function refund(actor, orderId, body, requestKey) {
    owner(actor);
    const fingerprint = hash([orderId, String(integer(body.foodSatang)), String(integer(body.deliverySatang)), body.reason, body.destinationBankCode, body.destinationIdentifier, body.destinationName]);
    return db.transaction(async q => {
      const snapshot = await q('order_financial_snapshots').where({ order_id: orderId }).first();
      if (!snapshot) fail('legacy_refund_not_supported', 'ออเดอร์นี้ไม่มีบัญชีรับเงิน Platform');
      await lockMerchant(q, snapshot.merchant_id);
      const previous = await replay(q, 'finance_refunds', snapshot.merchant_id, requestKey, fingerprint);
      if (previous) { const { encrypted_destination, ...safe } = previous; void encrypted_destination; return safe; }
      const order = await q('orders').where({ id: orderId }).forUpdate().first();
      if (!body.reason || body.reason.length > 500) throw new HttpError(422, 'finance_reason_required');
      const amounts = refundAllocation(snapshot, await refundTotals(q, orderId), body.foodSatang, body.deliverySatang);
      const refundId = id();
      let destination = {};
      if (BigInt(amounts.customer_refund_satang)) {
        if (!/^\d{3}$/.test(body.destinationBankCode) || typeof body.destinationIdentifier !== 'string' || !/^\d{6,20}$/.test(body.destinationIdentifier) || typeof body.destinationName !== 'string' || !body.destinationName.trim() || body.destinationName.length > 160) throw new HttpError(422,'verified_refund_destination_required','กรุณาระบุบัญชีคืนเงินที่ตรวจสอบกับลูกค้าแล้ว');
        destination = { destination_bank_code: body.destinationBankCode, destination_masked: masked(body.destinationIdentifier),
          encrypted_destination: crypt().encrypt(`finance:refund:${refundId}`, JSON.stringify({ identifier: body.destinationIdentifier, name: body.destinationName })) };
      }
      const [row] = await q('finance_refunds').insert({ id: refundId, order_id: orderId, merchant_id: snapshot.merchant_id, ...destination,
        idempotency_key: requestKey, fingerprint, reason: body.reason, approved_by_admin_id: actor.id, ...amounts }).returning('*');
      const b = await balances(snapshot.merchant_id, q);
      const bucket = order.status === 'COMPLETED' ? 'AVAILABLE' : ['REJECTED','CANCELLED'].includes(order.status) ? 'HELD' : 'PENDING';
      const recovery = BigInt(amounts.merchant_recovery_satang), recovered = min(BigInt(b[bucket]), recovery);
      if (recovery || BigInt(amounts.commission_satang) || BigInt(amounts.subsidy_satang)) await post(q, snapshot.merchant_id, `REFUND_RECOGNIZE:${row.id}`, 'REFUND_RECOGNIZE', { refund_id: row.id }, [
        [`MERCHANT_${bucket}`,'D',recovered], ['MERCHANT_DEBT','D',recovery-recovered],
        [order.status === 'COMPLETED' ? 'COMMISSION_REVENUE' : 'COMMISSION_DEFERRED','D',amounts.commission_satang],
        ['REFUND_PAYABLE','C',amounts.customer_refund_satang], ['SUBSIDY_EXPENSE','C',amounts.subsidy_satang],
      ]);
      await log(q, actor, 'REFUND_RECOGNIZED', 'FINANCE_REFUND', row.id, { order_id: orderId });
      const { encrypted_destination, ...safe } = row; void encrypted_destination; return safe;
    });
  }
  async function refundAction(actor, refundId, action, body) {
    owner(actor);
    return db.transaction(async q => {
      let row = await q('finance_refunds').where({ id: refundId }).first();
      if (!row) throw new HttpError(404, 'refund_not_found');
      await lockMerchant(q, row.merchant_id);
      row = await q('finance_refunds').where({ id: row.id }).forUpdate().first();
      if (action === 'processing' && row.status === 'APPROVED') {
        if (!BigInt(row.customer_refund_satang)) fail('refund_no_cash_transfer');
        const config = await runtime(q), recipient = await q('platform_payment_recipients').where({ id: config.recipient_version_id }).first();
        await q('finance_transfers').insert({ id: id(), merchant_id: row.merchant_id, refund_id: row.id, recipient_version_id: recipient.id,
          source_account_key: recipient.source_account_key, amount_satang: row.customer_refund_satang, initiated_by_admin_id: actor.id });
        await q('finance_refunds').where({ id: row.id }).update({ status: 'PROCESSING' });
      } else if (action === 'paid' && row.status === 'PROCESSING') {
        await confirmTransfer(q, actor, { refund_id: row.id }, body);
        await post(q, row.merchant_id, `REFUND_PAID:${row.id}`, 'REFUND_PAID', { refund_id: row.id }, [['REFUND_PAYABLE','D',row.customer_refund_satang],['CASH_CLEARING','C',row.customer_refund_satang]]);
        await q('finance_refunds').where({ id: row.id }).update({ status: 'PAID', paid_at: q.fn.now() });
      } else fail('invalid_refund_transition');
      await log(q, actor, `REFUND_${action.toUpperCase()}`, 'FINANCE_REFUND', row.id);
      return { ok: true };
    });
  }
  async function purchaseAd(actor, body, requestKey) {
    manager(actor);
    if (body.confirm !== true) throw new HttpError(422, 'ad_consent_required');
    const fingerprint = hash([body.bannerId, 'AD_V1', '30000', 30]);
    return db.transaction(async q => {
      await lockMerchant(q, actor.merchant_id);
      const previous = await replay(q, 'advertising_orders', actor.merchant_id, requestKey, fingerprint);
      if (previous) return previous;
      const banner = await q('banners').where({ id: body.bannerId, merchant_id: actor.merchant_id, scope: 'MERCHANT' }).whereNull('deleted_at').forUpdate().first();
      if (!banner || !['DRAFT','ARCHIVED'].includes(banner.status)) throw new HttpError(404, 'eligible_banner_not_found');
      const b = await balances(actor.merchant_id, q);
      if (BigInt(b.AVAILABLE) < 30000n || BigInt(b.DEBT) || BigInt(b.HELD)) fail('insufficient_available', 'ยอดพร้อมใช้ไม่เพียงพอสำหรับค่าโฆษณา ฿300');
      const [row] = await q('advertising_orders').insert({ id: id(), merchant_id: actor.merchant_id, banner_id: banner.id,
        requested_by_staff_id: actor.id, idempotency_key: requestKey, fingerprint }).returning('*');
      await post(q, actor.merchant_id, `AD_PURCHASE:${row.id}`, 'AD_PURCHASE', { advertising_order_id: row.id }, [['MERCHANT_AVAILABLE','D',30000],['AD_DEFERRED','C',30000]]);
      await log(q, actor, 'AD_PURCHASED', 'ADVERTISING_ORDER', row.id);
      return row;
    });
  }
  async function adAction(actor, adId, action, reason) {
    if (actor?.role === 'MANAGER') { if (action !== 'cancel') throw new HttpError(403, 'finance_permission_denied'); } else if (actor) admin(actor);
    else if (action !== 'expire') throw new HttpError(403, 'finance_permission_denied');
    return db.transaction(async q => {
      let row = await q('advertising_orders').where({ id: adId }).first();
      if (!row || (actor?.role === 'MANAGER' && row.merchant_id !== actor.merchant_id)) throw new HttpError(404, 'ad_not_found');
      await lockMerchant(q, row.merchant_id);
      row = await q('advertising_orders').where({ id: row.id }).forUpdate().first();
      if (!['PAID_PENDING_REVIEW','ACTIVE'].includes(row.status)) fail('invalid_ad_transition');
      const clock = await now(q);
      const changes = {};
      if (action === 'activate' && row.status === 'PAID_PENDING_REVIEW') {
        Object.assign(changes, { status: 'ACTIVE', activated_at: clock, scheduled_end_at: new Date(clock.valueOf()+2592000000) });
        await q('banners').where({ id: row.banner_id, merchant_id: row.merchant_id }).update({ status: 'PUBLISHED', starts_at: clock, ends_at: changes.scheduled_end_at });
      } else {
        if (!['reject','cancel','terminate','expire'].includes(action) || (action === 'reject' && row.status !== 'PAID_PENDING_REVIEW') || (action === 'expire' && (row.status !== 'ACTIVE' || clock < new Date(row.scheduled_end_at)))) fail('invalid_ad_transition');
        const physicallyServed = row.status === 'ACTIVE' ? served(row.fee_satang, row.activated_at, row.scheduled_end_at, clock) : 0n;
        let earned = physicallyServed;
        // Merchant cancellation forfeits the remaining service entitlement by explicit policy.
        if (action === 'cancel' && row.status === 'ACTIVE') earned = 30000n;
        const refund = action === 'cancel' && row.status === 'ACTIVE' ? 0n : 30000n-earned;
        if (earned) await post(q, row.merchant_id, `AD_EARN:${row.id}`, 'AD_EARN', { advertising_order_id: row.id }, [['AD_DEFERRED','D',earned],['AD_REVENUE','C',earned]]);
        if (refund) await post(q, row.merchant_id, `AD_REFUND:${row.id}`, 'AD_REFUND', { advertising_order_id: row.id }, [['AD_DEFERRED','D',refund],...await creditAvailable(q, row.merchant_id, refund)]);
        Object.assign(changes, { status: action === 'expire' ? 'EXPIRED' : action === 'reject' ? 'REJECTED_REFUNDED' : action === 'cancel' ? 'CANCELLED' : 'TERMINATED',
          terminated_at: clock, termination_reason: reason || action, served_satang: String(physicallyServed), unserved_satang: String(30000n-physicallyServed), forfeited_satang: String(earned-physicallyServed), refunded_satang: String(refund) });
        await q('banners').where({ id: row.banner_id }).update({ status: 'ARCHIVED' });
      }
      await q('advertising_orders').where({ id: row.id }).update(changes);
      await log(q, actor, `AD_${changes.status}`, 'ADVERTISING_ORDER', row.id);
      return { ...row, ...changes };
    });
  }
  async function setMode(actor, mode) {
    manager(actor);
    if (!['MANUAL_WITHDRAWAL','AUTO_3_DAYS'].includes(mode)) throw new HttpError(400, 'invalid_settlement_mode');
    await db.transaction(async q => { await lockMerchant(q, actor.merchant_id); await q('merchants').where({ id: actor.merchant_id }).update({ settlement_mode: mode }); await log(q, actor, 'SETTLEMENT_MODE_CHANGED', 'MERCHANT', actor.merchant_id, { mode }); });
    return { mode };
  }
  async function runScheduled() {
    const result = { requested: 0, skipped: 0, expired: 0 };
    const clock = await now(db), window = Math.floor(clock.valueOf()/259200000);
    for (const m of await db('merchants').where({ settlement_mode: 'AUTO_3_DAYS', is_active: true }).whereNull('deleted_at')) {
      try {
        const requestKey = `AUTO_3_DAYS:${m.id}:${window}`;
        if (await db('merchant_withdrawals').where({ merchant_id: m.id, settlement_window: requestKey }).first()) { result.skipped++; continue; }
        await withdrawal({ role: 'MANAGER', merchant_id: m.id }, { amountSatang: (await balances(m.id)).AVAILABLE }, requestKey, true); result.requested++;
      } catch (e) { if (!(e instanceof HttpError) && e.code !== '23505') throw e; result.skipped++; }
    }
    for (const ad of await db('advertising_orders').where({ status: 'ACTIVE' }).where('scheduled_end_at','<=',clock)) {
      try { await adAction(null, ad.id, 'expire'); result.expired++; } catch(e) { if(e.code!=='invalid_ad_transition')throw e; }
    }
    return result;
  }
  async function revealDestination(actor, kind, entityId) {
    owner(actor);
    return db.transaction(async q => {
      if (!['payout-accounts','refunds'].includes(kind)) throw new HttpError(404,'finance_destination_not_found');
      const row = await q(kind==='payout-accounts'?'merchant_payout_accounts':'finance_refunds').where({id:entityId}).first();
      if (!row) throw new HttpError(404,'finance_destination_not_found');
      const value = kind==='payout-accounts'
        ? JSON.parse(crypt().decrypt(`finance:payout:${row.id}`,row.encrypted_account))
        : JSON.parse(crypt().decrypt(`finance:refund:${row.id}`,row.encrypted_destination));
      await log(q,actor,'FINANCE_DESTINATION_REVEALED',kind,entityId);
      return { bank_code:row.bank_code || row.destination_bank_code, identifier:value.identifier, account_name:value.accountName || value.name };
    });
  }
  async function merchantOverview(actor) {
    manager(actor);
    const merchant = await db('merchants').where({ id: actor.merchant_id }).first();
    const transactions = await db('financial_transactions').where({ merchant_id: merchant.id }).orderBy('id','desc').limit(100);
    const postings = transactions.length ? await db('financial_postings as p').join('financial_accounts as a','a.id','p.account_id').whereIn('p.transaction_id',transactions.map(t=>t.id)).select('p.transaction_id','a.kind','p.side','p.amount_satang') : [];
    const paidOut = await db('merchant_withdrawals').where({merchant_id:merchant.id,status:'PAID'}).sum('amount_satang as amount').first();
    const summary = (await db('order_financial_snapshots').where({merchant_id:merchant.id}).select(db.raw(`
      coalesce(sum(food_subtotal_satang),0)::text AS gross_food_satang,
      coalesce(sum(merchant_food_discount_satang+merchant_delivery_discount_satang),0)::text AS merchant_discount_satang,
      coalesce(sum(platform_subsidy_satang),0)::text AS platform_discount_satang,
      coalesce(sum(commission_satang),0)::text AS commission_satang,
      coalesce(sum(merchant_entitlement_satang),0)::text AS merchant_net_satang`)))[0];
    summary.advertising_expense_satang=String((await db('advertising_orders').where({merchant_id:merchant.id}).select(db.raw('coalesce(sum(fee_satang-refunded_satang),0)::text AS amount')).first()).amount);
    return { balances: await balances(actor.merchant_id), paid_out_satang: String(paidOut.amount || 0), eligibility: await eligibility(db, merchant), settlement_mode: merchant.settlement_mode,
      summary,
      accounts: (await db('merchant_payout_accounts').where({ merchant_id: merchant.id }).orderBy('created_at','desc')).map(accountView),
      withdrawals: await db('merchant_withdrawals as w').join('merchant_payout_accounts as a','a.id','w.payout_account_id').where('w.merchant_id', merchant.id).orderBy('w.created_at','desc').limit(100).select('w.*','a.masked_account','a.bank_code'),
      advertising: await db('advertising_orders').where({ merchant_id: merchant.id }).orderBy('consented_at','desc').limit(100),
      transactions: transactions.map(t=>({...t,postings:postings.filter(p=>p.transaction_id===t.id)})),
      banners: await db('banners').where({ merchant_id: merchant.id }).whereNull('deleted_at').select('id','title','status'),
      snapshots: await db('order_financial_snapshots').where({ merchant_id: merchant.id }).orderBy('order_id','desc').limit(100) };
  }
  async function adminOverview(actor) {
    admin(actor);
    const accounts = await db('financial_accounts as a').leftJoin('financial_postings as p','p.account_id','a.id').groupBy('a.kind').select('a.kind')
      .select(db.raw("coalesce(sum(CASE WHEN p.side='C' THEN p.amount_satang ELSE -p.amount_satang END),0)::text AS balance"));
    return { runtime: await runtime(), accounts,
      payouts: await db('merchant_withdrawals as w').join('merchant_payout_accounts as a','a.id','w.payout_account_id').join('merchants as m','m.id','w.merchant_id').orderBy('w.created_at','desc').limit(100).select('w.*','a.masked_account','a.bank_code','m.store_name'),
      payout_accounts: (await db('merchant_payout_accounts').orderBy('created_at','desc').limit(100)).map(accountView),
      refunds: (await db('finance_refunds').orderBy('created_at','desc').limit(100)).map(({ encrypted_destination, ...safe }) => { void encrypted_destination; return safe; }),
      advertising: await db('advertising_orders').orderBy('consented_at','desc').limit(100),
      cases: await db('finance_reconciliation_cases').orderBy('created_at','desc').limit(100),
      summary: { ...(await db('order_financial_snapshots').select(db.raw('coalesce(sum(food_subtotal_satang),0)::text AS gmv_satang, coalesce(sum(commission_satang),0)::text AS captured_commission_satang')))[0],
        paid_out_satang:String((await db('merchant_withdrawals').where({status:'PAID'}).sum('amount_satang as amount').first()).amount || 0),
        refunded_satang:String((await db('finance_refunds').where({status:'PAID'}).sum('customer_refund_satang as amount').first()).amount || 0) } };
  }
  async function reconcile(actor) {
    admin(actor);
    return db.transaction(async q => {
      await q.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const issues = [];
      for (const order of await q('orders').where({ collection_mode: 'PLATFORM', payment_status: 'PAID' })) {
        const events = await q('financial_transactions').where({ order_id: order.id }).pluck('kind');
        if (!events.includes('ORDER_PAID')) issues.push({ case_key: `MISSING_CAPTURE:${order.id}`, kind: 'MISSING_CAPTURE', order_id: order.id, merchant_id: order.merchant_id });
        const s = await q('order_financial_snapshots').where({ order_id: order.id }).first();
        const refunds = await refundTotals(q, order.id);
        if (s && order.status === 'COMPLETED' && !events.includes('ORDER_COMPLETED') && (BigInt(s.merchant_entitlement_satang)>BigInt(refunds.merchant_recovery_satang) || BigInt(s.commission_satang)>BigInt(refunds.commission_satang))) issues.push({ case_key: `MISSING_RELEASE:${order.id}`, kind: 'MISSING_RELEASE', order_id: order.id, merchant_id: order.merchant_id });
        if (s && Object.entries({ food_satang: 'food_subtotal_satang', delivery_satang: 'delivery_fee_satang', commission_satang:'commission_satang', merchant_recovery_satang:'merchant_entitlement_satang' }).some(([a,b]) => BigInt(refunds[a])>BigInt(s[b]))) issues.push({ case_key:`OVER_REFUND:${order.id}`,kind:'OVER_REFUND',order_id:order.id,merchant_id:order.merchant_id });
      }
      for (const w of await q('merchant_withdrawals')) {
        const kinds = await q('financial_transactions').where({ withdrawal_id: w.id }).pluck('kind');
        const expected = w.status === 'PAID' ? 'WITHDRAWAL_PAID' : ['FAILED','REJECTED','CANCELLED'].includes(w.status) ? 'WITHDRAWAL_RELEASE' : 'WITHDRAWAL_RESERVE';
        const confirmed=await q('finance_transfers').where({withdrawal_id:w.id,status:'CONFIRMED'}).first();
        if (!kinds.includes(expected) || (w.status==='PAID' && (!confirmed || confirmed.amount_satang!==w.amount_satang)) || (confirmed && w.status!=='PAID')) issues.push({ case_key:`WITHDRAWAL_MISMATCH:${w.id}`,kind:'WITHDRAWAL_MISMATCH',merchant_id:w.merchant_id });
      }
      for(const r of await q('finance_refunds')) {
        const kinds=await q('financial_transactions').where({refund_id:r.id}).pluck('kind');
        const confirmed=await q('finance_transfers').where({refund_id:r.id,status:'CONFIRMED'}).first();
        if((BigInt(r.merchant_recovery_satang)+BigInt(r.commission_satang)+BigInt(r.subsidy_satang)>0n && !kinds.includes('REFUND_RECOGNIZE')) ||
          (r.status==='PAID' && (!kinds.includes('REFUND_PAID') || !confirmed || confirmed.amount_satang!==r.customer_refund_satang)) || (confirmed && r.status!=='PAID'))
          issues.push({case_key:`REFUND_MISMATCH:${r.id}`,kind:'REFUND_MISMATCH',merchant_id:r.merchant_id,order_id:r.order_id});
      }
      for (const ad of await q('advertising_orders')) {
        const kinds = await q('financial_transactions').where({ advertising_order_id: ad.id }).pluck('kind');
        if (!kinds.includes('AD_PURCHASE') || (BigInt(ad.refunded_satang)>0n && !kinds.includes('AD_REFUND')) || (BigInt(ad.served_satang)>0n && !kinds.includes('AD_EARN'))) issues.push({ case_key:`AD_MISMATCH:${ad.id}`,kind:'AD_MISMATCH',merchant_id:ad.merchant_id });
      }
      for (const issue of issues) await q('finance_reconciliation_cases').insert({ id: id(), ...issue }).onConflict('case_key').ignore();
      await log(q, actor, 'FINANCE_RECONCILED', 'FINANCE', null, { issues: issues.length });
      return { issues: issues.length };
    });
  }
  return { runtime, route, recipient, capture, orderEvent, balances, configure, saveAccount, verifyAccount, withdrawal, withdrawalAction,
    refund, refundAction, purchaseAd, adAction, setMode, runScheduled, merchantOverview, adminOverview, reconcile, lockMerchant, revealDestination };
}
module.exports = { createFinanceService };
