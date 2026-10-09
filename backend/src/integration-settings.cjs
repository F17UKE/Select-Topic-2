const { fields } = require('./integration-fields.cjs');
const { createIntegrationCrypto } = require('./integration-crypto.cjs');
const { resolveIntegrationKey } = require('./integration-key.cjs');
const { HttpError } = require('./http.cjs');
const { paymentConfig } = require('./config.cjs');
const { customerAuthConfig } = require('./auth.cjs');
const { lineIntegrationConfig } = require('./line-config.cjs');
const { validatePromptPay, maskIdentifier } = require('./payment-service.cjs');
const { createEasyslipProvider } = require('./payment-verifiers/easyslip-provider.cjs');
const { createMerchantRecipientSettings } = require('./merchant-recipient-settings.cjs');

const revealableSecrets = new Set(['EASYSLIP_API_KEY', 'CHECKSLIP_API_KEY',
  'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_WEBHOOK_SECRET']);

function createIntegrationSettings({ db, audit, env = process.env, fetchImpl = fetch }) {
  if (env.NODE_ENV === 'production' && env.LINE_MESSAGING_MODE === 'mock') throw new Error('Mock LINE Messaging is forbidden in production');
  const encryptionKey = resolveIntegrationKey(env);
  const crypto = createIntegrationCrypto(encryptionKey.encoded);
  const empty = () => ({ normal_values: {}, secret_values: {}, version: 0 });
  const defaults = { PAYMENT_VERIFICATION_MODE: env.NODE_ENV === 'production' ? 'checkslip' : 'mock',
    LINE_MESSAGING_MODE: env.NODE_ENV === 'production' ? 'real' : 'disabled' };
  async function readRow(query = db) { return (await query('integration_settings').where({ id: 1 }).first()) || empty(); }
  const recipients = createMerchantRecipientSettings({ db, audit, crypto, env, readRow });
  function resolve(row) {
    const resolved = { ...env };
    for (const [name, spec] of Object.entries(fields)) {
      resolved[name] = env[name] || spec.default || defaults[name] || '';
      if (Object.hasOwn(row.normal_values, name)) resolved[name] = row.normal_values[name];
      if (Object.hasOwn(row.secret_values, name)) resolved[name] = crypto.decrypt(name, row.secret_values[name]);
    }
    resolved.EASYSLIP_MERCHANT_ACCOUNTS = recipients.merge(row);
    return resolved;
  }
  async function environment() { return resolve(await readRow()); }
  function validateField(name, value) {
    const spec = fields[name];
    if (!spec || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value) || value.includes('\0')) throw new HttpError(400, 'invalid_integration_value');
    if (spec.type === 'secret') {
      if (value && (value !== value.trim() || /•|\*{3}|YOUR_|CHANGE_ME|<[^>]+>/i.test(value))) throw new HttpError(400, 'invalid_integration_secret');
      if (spec.identifier && value && !/^[0-9 -]+$/.test(value)) throw new HttpError(400, 'invalid_promptpay_identifier');
    } else {
      if (value.length > 500) throw new HttpError(400, 'invalid_integration_value');
      if (spec.type === 'enum' && !spec.options.includes(value)) throw new HttpError(400, 'invalid_integration_value');
      if (spec.type === 'boolean' && !['true', 'false'].includes(value)) throw new HttpError(400, 'invalid_integration_value');
      if (spec.type === 'channel' && value && !/^\d{5,20}$/.test(value)) throw new HttpError(400, 'invalid_line_channel_id');
      if (spec.type === 'liff' && value && !/^\d{5,20}-[A-Za-z0-9]{4,40}$/.test(value)) throw new HttpError(400, 'invalid_liff_id');
      if (spec.type === 'fixed' && value !== spec.default) throw new HttpError(400, 'invalid_integration_url');
      if (spec.type === 'url' && value) {
        try {
          const url = new URL(value);
          if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error();
        } catch { throw new HttpError(400, 'invalid_integration_url'); }
      }
    }
  }
  function checkPayment(e) {
    if (e.PAYMENT_VERIFICATION_MODE === 'easyslip') validateField('EASYSLIP_API_KEY', e.EASYSLIP_API_KEY);
    if (e.PAYMENT_VERIFICATION_MODE === 'checkslip') { validateField('CHECKSLIP_API_KEY', e.CHECKSLIP_API_KEY); validateField('CHECKSLIP_API_URL', e.CHECKSLIP_API_URL); }
    const config = paymentConfig(e);
    if (config.verificationMode === 'easyslip') {
      const entries = Object.entries(config.easyslipMerchantAccounts);
      // Readiness is per merchant. Missing mapping fails at the existing preflight;
      // it must not prevent configured merchants (or payment-history reads) working.
      const provider = createEasyslipProvider(config);
      for (const [merchantId, m] of entries) provider.preflight({ merchantId, expectedRecipientType: m?.promptpayType, expectedRecipient: m?.promptpayId });
    }
    return config;
  }
  function status(e) {
    const readiness = (fn) => { try { fn(); return 'READY'; } catch { return 'INCOMPLETE'; } };
    return {
      payment: { configuration: readiness(() => checkPayment(e)), enabled: e.PAYMENT_INTEGRATION_ENABLED === 'true', real_verification: 'NOT_VERIFIED' },
      easyslip: { configuration: readiness(() => checkPayment({ ...e, PAYMENT_VERIFICATION_MODE: 'easyslip' })), enabled: e.PAYMENT_INTEGRATION_ENABLED === 'true' && e.PAYMENT_VERIFICATION_MODE === 'easyslip', real_verification: 'NOT_VERIFIED' },
      checkslip: { configuration: readiness(() => checkPayment({ ...e, PAYMENT_VERIFICATION_MODE: 'checkslip' })), real_verification: 'NOT_VERIFIED' },
      promptpay: { configuration: readiness(() => { validatePromptPay(e.PLATFORM_PROMPTPAY_TYPE, e.PLATFORM_PROMPTPAY_ID); if (!e.PLATFORM_PROMPTPAY_NAME) throw new Error(); }), wired_to_payment: false, real_verification: 'NOT_VERIFIED' },
      login: { configuration: readiness(() => { if (!e.LINE_CHANNEL_ID || !e.LINE_LIFF_ID) throw new Error(); validateField('LINE_CHANNEL_ID', e.LINE_CHANNEL_ID); validateField('LINE_LIFF_ID', e.LINE_LIFF_ID); }), enabled: e.LINE_LOGIN_ENABLED === 'true', real_verification: 'NOT_VERIFIED' },
      messaging: { configuration: readiness(() => {
        if (!e.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || !(e.LINE_WEBHOOK_SECRET || e.LINE_CHANNEL_SECRET)) throw new Error();
        validateField('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', e.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN);
        validateField('LINE_WEBHOOK_SECRET', e.LINE_WEBHOOK_SECRET || e.LINE_CHANNEL_SECRET);
      }), enabled: e.LINE_MESSAGING_MODE !== 'disabled', real_verification: 'NOT_VERIFIED' },
    };
  }
  function publicView(row) {
    const e = resolve(row);
    let publicUrl = null;
    try { const u = new URL(env.APP_PUBLIC_URL); if (u.protocol === 'https:' && !u.username && !u.password && !/^(localhost|127\.|\[::1\])/.test(u.hostname)) publicUrl = u.origin; } catch { /* no public URL configured */ }
    return { version: row.version, encryption_ready: crypto.ready, encryption_key_source: encryptionKey.source, production: env.NODE_ENV === 'production',
      fields: Object.entries(fields).map(([name, spec]) => ({ name, ...spec,
        source: Object.hasOwn(row.normal_values, name) || Object.hasOwn(row.secret_values, name) ? 'DATABASE' : env[name] ? 'ENVIRONMENT' : 'DEFAULT',
        configured: Boolean(e[name]),
        revealable: revealableSecrets.has(name) && Object.hasOwn(row.secret_values, name),
        ...(spec.type === 'secret' ? { masked: e[name] ? (spec.identifier && e[name].length > 4 ? maskIdentifier(e[name]) : 'ตั้งค่าแล้ว') : '' } : { value: e[name] }),
      })), status: status(e), webhook_url: publicUrl ? `${publicUrl}/api/webhooks/line` : null, liff_endpoint: publicUrl ? `${publicUrl}/` : null,
      merchant_recipients_source: Object.keys(row.secret_values).some((key) => key.startsWith('MERCHANT_RECIPIENT_')) ? 'DATABASE' : env.EASYSLIP_MERCHANT_ACCOUNTS ? 'ENVIRONMENT' : 'NOT_CONFIGURED' };
  }
  async function get() { const row = await readRow(); return { ...publicView(row), merchant_recipients: await recipients.summary(row) }; }
  async function reveal(actor, name, context = {}) {
    if (actor.role !== 'SUPER_ADMIN') throw new HttpError(403, 'admin_permission_denied');
    if (!revealableSecrets.has(name)) throw new HttpError(400, 'secret_not_revealable');
    const row = await readRow();
    // Only secrets explicitly saved in encrypted settings; never ENV fallbacks.
    if (!Object.hasOwn(row.secret_values, name)) throw new HttpError(404, 'stored_secret_missing');
    const value = crypto.decrypt(name, row.secret_values[name]);
    // Fail closed if the audit cannot be written. Never include value or password.
    await audit.append({ actorId: actor.id, action: 'SECRET_REVEALED', entityType: 'INTEGRATION_SETTINGS', entityId: 1,
      ip: context.ip, metadata: { setting: name, version: row.version } });
    return { value };
  }
  async function update(actor, body, context = {}) {
    if (actor.role !== 'SUPER_ADMIN') throw new HttpError(403, 'admin_permission_denied');
    if (!body || !Number.isSafeInteger(body.version) || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)
      || (body.clear !== undefined && (!Array.isArray(body.clear) || body.clear.some((name) => typeof name !== 'string')))) throw new HttpError(400, 'invalid_integration_update');
    const clear = body.clear || [];
    const names = [...new Set([...Object.keys(body.values), ...clear])];
    for (const name of names) {
      if (!Object.hasOwn(fields, name) || (clear.includes(name) && Object.hasOwn(body.values, name))) throw new HttpError(400, 'invalid_integration_field');
      if (Object.hasOwn(body.values, name)) validateField(name, body.values[name]);
    }
    const dangerous = clear.length || names.some((name) => name === 'PLATFORM_PROMPTPAY_ID' && body.values[name]
      || fields[name].type === 'boolean' && body.values[name] === 'false'
      || name === 'LINE_MESSAGING_MODE' && body.values[name] === 'disabled'
      || name === 'PAYMENT_VERIFICATION_MODE');
    if (dangerous && body.confirm !== true) throw new HttpError(400, 'integration_confirmation_required');
    await db.transaction(async (trx) => {
      await trx('integration_settings').insert({ id: 1 }).onConflict('id').ignore();
      const before = await trx('integration_settings').where({ id: 1 }).forUpdate().first();
      if (before.version !== body.version) throw new HttpError(409, 'integration_version_conflict');
      const row = { ...before, normal_values: { ...before.normal_values }, secret_values: { ...before.secret_values } };
      const changed = [];
      for (const name of names) {
        const target = fields[name].type === 'secret' ? row.secret_values : row.normal_values;
        if (clear.includes(name)) { delete target[name]; changed.push(name); }
        else if (fields[name].type !== 'secret' || body.values[name] !== '') {
          target[name] = fields[name].type === 'secret' ? crypto.encrypt(name, body.values[name]) : body.values[name];
          changed.push(name);
        }
      }
      if (!changed.length) return;
      const e = resolve(row);
      try {
        if (env.NODE_ENV === 'production' && (e.PAYMENT_VERIFICATION_MODE === 'mock' || e.LINE_MESSAGING_MODE === 'mock')) throw new Error();
        customerAuthConfig(e); // preserves the existing production dev-login guards
        if (changed.some((name) => ['payment', 'easyslip', 'checkslip'].includes(fields[name].section)) && e.PAYMENT_INTEGRATION_ENABLED === 'true') checkPayment(e);
        if (changed.some((name) => fields[name].section === 'promptpay') && e.PLATFORM_PROMPTPAY_ID) validatePromptPay(e.PLATFORM_PROMPTPAY_TYPE, e.PLATFORM_PROMPTPAY_ID);
        if (e.PLATFORM_PROMPTPAY_ENABLED === 'true' && (!e.PLATFORM_PROMPTPAY_ID || !e.PLATFORM_PROMPTPAY_NAME)) throw new Error();
        if (changed.some((name) => fields[name].section === 'login') && e.LINE_LOGIN_ENABLED === 'true'
          && (body.values.LINE_LOGIN_ENABLED === 'true' || e.CUSTOMER_AUTH_MODE === 'line') && (!e.LINE_CHANNEL_ID || !e.LINE_LIFF_ID)) throw new Error();
        if (changed.some((name) => fields[name].section === 'messaging') && e.LINE_MESSAGING_MODE === 'real' && !e.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) throw new Error();
        if (body.values.LINE_WEBHOOK_ENABLED === 'true' && !(e.LINE_WEBHOOK_SECRET || e.LINE_CHANNEL_SECRET)) throw new Error();
      } catch { throw new HttpError(422, 'integration_configuration_incomplete', 'การตั้งค่าไม่ครบหรือไม่รองรับในโหมดนี้'); }
      const previous = resolve(before);
      await trx('integration_settings').where({ id: 1 }).update({ normal_values: JSON.stringify(row.normal_values), secret_values: JSON.stringify(row.secret_values),
        version: before.version + 1, updated_at: trx.fn.now(), updated_by_admin_id: actor.id });
      await audit.append({ actorId: actor.id, action: 'INTEGRATION_SETTINGS_CHANGED', entityType: 'INTEGRATION_SETTINGS', entityId: 1, ...context,
        metadata: { changes: changed.map((name) => ({ setting: name, action: clear.includes(name) ? 'CLEAR_OVERRIDE' : 'REPLACE', previous_configured: Boolean(previous[name]), new_configured: Boolean(e[name]) })) } }, trx);
    });
    return get();
  }
  async function testConfiguration(actor, context) {
    const view = await get();
    await audit.append({ actorId: actor.id, action: 'INTEGRATION_CONFIGURATION_TESTED', entityType: 'INTEGRATION_SETTINGS', entityId: 1, ...context, metadata: { version: view.version } });
    return { status: view.status, real_verification: 'NOT_VERIFIED', message: 'CONFIGURATION ONLY — REAL PROVIDER VERIFICATION REQUIRED' };
  }
  async function testEasyslip(actor, body, context) {
    if (body?.confirmRealRequest !== true) throw new HttpError(400, 'real_provider_confirmation_required');
    const row = await readRow();
    if (body.version !== row.version) throw new HttpError(409, 'integration_version_conflict');
    const e = resolve(row);
    if (!e.EASYSLIP_API_KEY) throw new HttpError(422, 'easyslip_api_key_missing');
    // Official v2 GET /info; no slip verification, no quota or financial write.
    let result = 'NOT_VERIFIED';
    let failureCode = 'PROVIDER_UNAVAILABLE';
    await audit.append({ actorId: actor.id, action: 'EASYSLIP_ACCOUNT_TEST_REQUESTED', entityType: 'INTEGRATION_SETTINGS', ...context, metadata: { version: row.version } });
    try {
      const response = await fetchImpl('https://api.easyslip.com/v2/info', { method: 'GET', headers: { Authorization: `Bearer ${e.EASYSLIP_API_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (response.status === 401 || response.status === 403) failureCode = 'INVALID_API_KEY';
      else if (response.ok) {
        const data = await response.json();
        if (data.success === true && data.data?.branch?.isActive === true) { result = 'ACCOUNT_AUTH_VERIFIED'; failureCode = null; }
        else if (data.success === true && data.data?.branch?.isActive === false) failureCode = 'ACCOUNT_INACTIVE';
        else failureCode = 'INVALID_RESPONSE';
      }
    } catch { /* provider details and token must never leave this boundary */ }
    await audit.append({ actorId: actor.id, action: 'EASYSLIP_ACCOUNT_TEST_FINISHED', entityType: 'INTEGRATION_SETTINGS', ...context, metadata: { version: row.version, result, failure_code: failureCode } });
    return { result, version: row.version, failure_code: failureCode,
      account_status: result === 'ACCOUNT_AUTH_VERIFIED' ? 'ACTIVE' : failureCode === 'ACCOUNT_INACTIVE' ? 'INACTIVE' : null,
      slip_verification: 'NOT_VERIFIED' };
  }
  async function getPaymentIntegrationConfig({ readOnly = false } = {}) {
    const e = await environment();
    const enabled = e.PAYMENT_INTEGRATION_ENABLED === 'true';
    return { config: readOnly || !enabled ? paymentConfig(e, { storageOnly: true }) : checkPayment(e), enabled };
  }
  async function getLineIntegrationConfig() {
    const e = await environment();
    // Messaging/webhook do not depend on Login/LIFF readiness. Login validates its own identity config.
    return { ...lineIntegrationConfig(e, { validateLogin: false }), loginEnabled: e.LINE_LOGIN_ENABLED === 'true', webhookEnabled: e.LINE_WEBHOOK_ENABLED === 'true' };
  }
  return { get, update, reveal, recipients, environment, testConfiguration, testEasyslip, getPaymentIntegrationConfig, getLineIntegrationConfig };
}
module.exports = { createIntegrationSettings };
