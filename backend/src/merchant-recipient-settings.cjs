const { HttpError } = require('./http.cjs');
const { recipientMapping } = require('./payment-verifiers/easyslip-provider.cjs');
const { validatePromptPay, maskIdentifier } = require('./payment-service.cjs');

const prefix = 'MERCHANT_RECIPIENT_';
function environmentAccounts(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function createMerchantRecipientSettings({ db, audit, crypto, env, readRow }) {
  const keyFor = (id) => `${prefix}${id}`;
  function stored(row, id) {
    const key = keyFor(id);
    return Object.hasOwn(row.secret_values, key) ? JSON.parse(crypto.decrypt(key, row.secret_values[key])) : undefined;
  }
  function merge(row) {
    const accounts = environmentAccounts(env.EASYSLIP_MERCHANT_ACCOUNTS);
    // Preserve existing fail-closed behavior for malformed operator configuration.
    if (!accounts) return env.EASYSLIP_MERCHANT_ACCOUNTS;
    for (const key of Object.keys(row.secret_values)) {
      if (!/^MERCHANT_RECIPIENT_[1-9]\d*$/.test(key)) continue;
      const id = key.slice(prefix.length);
      const mapping = stored(row, id);
      if (mapping.enabled === false) delete accounts[id];
      else accounts[id] = mapping;
    }
    return JSON.stringify(accounts);
  }
  async function merchant(id, query = db, lock = false) {
    const q = query('merchants').where({ id }).whereNull('deleted_at');
    const row = await (lock ? q.forUpdate() : q).first('id', 'store_name', 'promptpay_id', 'promptpay_identifier_type', 'is_active');
    if (!row) throw new HttpError(404, 'merchant_not_found', 'ไม่พบร้านค้า');
    return row;
  }
  function view(row, m) {
    const override = stored(row, m.id);
    const accounts = environmentAccounts(env.EASYSLIP_MERCHANT_ACCOUNTS);
    const mapping = override === undefined ? accounts?.[String(m.id)] : override;
    let ready = false;
    try {
      validatePromptPay(m.promptpay_identifier_type, m.promptpay_id);
      if (mapping?.enabled === false) throw new Error();
      recipientMapping({ easyslipMerchantAccounts: { [m.id]: mapping } }, { merchantId: m.id,
        expectedRecipientType: m.promptpay_identifier_type, expectedRecipient: m.promptpay_id });
      ready = true;
    } catch { /* public readiness must never disclose account values */ }
    return { merchant_id: m.id, store_name: m.store_name, version: row.version,
      source: override !== undefined ? 'DATABASE' : mapping ? 'ENVIRONMENT' : 'NOT_CONFIGURED',
      configured: ready, enabled: mapping ? mapping.enabled !== false : false,
      merchant_active: m.is_active, encryption_ready: crypto.ready,
      promptpay_type: m.promptpay_identifier_type, promptpay_masked: maskIdentifier(m.promptpay_id),
      bank_code: /^\d{3}$/.test(mapping?.bankCode) ? mapping.bankCode : '',
      bank_number_masked: /^\d{6,20}$/.test(mapping?.bankNumber) ? maskIdentifier(mapping.bankNumber) : '',
      reason: ready ? null : mapping?.enabled === false ? 'DISABLED' : 'RECIPIENT_NOT_CONFIGURED' };
  }
  async function get(id) { return view(await readRow(), await merchant(id)); }
  async function summary(row) {
    const merchants = await db('merchants').whereNull('deleted_at').select('id', 'store_name', 'promptpay_id', 'promptpay_identifier_type', 'is_active');
    const views = merchants.map((m) => view(row, m));
    return { configured: views.filter((m) => m.configured).length, total: views.length,
      active_configured: views.filter((m) => m.merchant_active && m.configured).length,
      active_total: views.filter((m) => m.merchant_active).length };
  }
  async function update(actor, id, body, context = {}) {
    if (actor.role !== 'SUPER_ADMIN') throw new HttpError(403, 'admin_permission_denied');
    const allowed = ['version', 'bankCode', 'bankNumber', 'enabled', 'clear', 'confirm'];
    if (!body || !Number.isSafeInteger(body.version) || body.confirm !== true
      || Object.keys(body).some((key) => !allowed.includes(key))
      || (body.clear !== undefined && typeof body.clear !== 'boolean')) throw new HttpError(400, 'invalid_recipient_settings');
    if (!body.clear && (typeof body.enabled !== 'boolean' || typeof body.bankCode !== 'string' || !/^\d{3}$/.test(body.bankCode)
      || typeof body.bankNumber !== 'string' || (body.bankNumber !== '' && !/^\d{6,20}$/.test(body.bankNumber)))) throw new HttpError(400, 'invalid_recipient_settings');
    await db.transaction(async (trx) => {
      const m = await merchant(id, trx, true);
      await trx('integration_settings').insert({ id: 1 }).onConflict('id').ignore();
      const row = await trx('integration_settings').where({ id: 1 }).forUpdate().first();
      if (row.version !== body.version) throw new HttpError(409, 'integration_version_conflict');
      const key = keyFor(id);
      const secrets = { ...row.secret_values };
      if (body.clear) delete secrets[key];
      else {
        const previous = stored(row, id) ?? environmentAccounts(env.EASYSLIP_MERCHANT_ACCOUNTS)?.[String(id)];
        const bankNumber = body.bankNumber || previous?.bankNumber;
        if (!/^\d{6,20}$/.test(bankNumber)) throw new HttpError(400, 'recipient_bank_number_required');
        validatePromptPay(m.promptpay_identifier_type, m.promptpay_id);
        const mapping = { promptpayType: m.promptpay_identifier_type, promptpayId: m.promptpay_id,
          bankCode: body.bankCode, bankNumber, enabled: body.enabled };
        // Bind to the server-owned merchant QR identity; client cannot supply either.
        recipientMapping({ easyslipMerchantAccounts: { [id]: mapping } }, { merchantId: id,
          expectedRecipientType: m.promptpay_identifier_type, expectedRecipient: m.promptpay_id });
        secrets[key] = crypto.encrypt(key, JSON.stringify(mapping));
      }
      await trx('integration_settings').where({ id: 1 }).update({ secret_values: JSON.stringify(secrets),
        version: row.version + 1, updated_at: trx.fn.now(), updated_by_admin_id: actor.id });
      await audit.append({ actorId: actor.id, action: body.clear ? 'MERCHANT_RECIPIENT_CLEARED' : 'MERCHANT_RECIPIENT_CHANGED',
        entityType: 'MERCHANT', entityId: id, ip: context.ip,
        metadata: { source: body.clear ? 'FALLBACK' : 'DATABASE', enabled: body.clear ? null : body.enabled, version: row.version + 1 } }, trx);
    });
    return get(id);
  }
  return { get, update, merge, summary };
}
module.exports = { createMerchantRecipientSettings };
