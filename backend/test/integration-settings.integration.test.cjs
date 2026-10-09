const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
require('../src/env.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createIntegrationSettings } = require('../src/integration-settings.cjs');
const { createIntegrationCrypto } = require('../src/integration-crypto.cjs');
const { createIntegrationRuntime } = require('../src/integration-runtime.cjs');
const { createCustomerAuth } = require('../src/auth.cjs');
const { createAdminAudit } = require('../src/admin-audit.cjs');
const { createAdminAuth } = require('../src/admin-auth.cjs');
const { createAdminService } = require('../src/admin-service.cjs');
const { createApp } = require('../src/app.cjs');
const { signatureFor } = require('../src/line-webhook.cjs');

test('integration secrets use authenticated encryption bound to field and version', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const c = createIntegrationCrypto(key);
  const encrypted = c.encrypt('EASYSLIP_API_KEY', 'synthetic-private-key');
  assert.equal(c.decrypt('EASYSLIP_API_KEY', encrypted), 'synthetic-private-key');
  assert.notEqual(encrypted, c.encrypt('EASYSLIP_API_KEY', 'synthetic-private-key'));
  assert.throws(() => c.decrypt('LINE_WEBHOOK_SECRET', encrypted), /integration_decryption_failed/);
  assert.throws(() => createIntegrationCrypto(crypto.randomBytes(32).toString('base64')).decrypt('EASYSLIP_API_KEY', encrypted), /integration_decryption_failed/);
  assert.throws(() => c.decrypt('EASYSLIP_API_KEY', encrypted.replace('v1.', 'v2.')), /integration_decryption_failed/);
  assert.throws(() => createIntegrationCrypto().encrypt('key', 'value'), /integration_encryption_unavailable/);
  assert.throws(() => createIntegrationCrypto('invalid'), /ENCRYPTION_KEY/);
});

test('Admin integration settings / runtime / security', { skip: !/^-c search_path=p0_test_[a-f0-9]{16}$/.test(process.env.PGOPTIONS || '') }, async (t) => {
  assert.equal(process.env.DB_HOST, '127.0.0.1');
  assert.equal(process.env.DB_NAME, 'select_topic_2_local');
  const db = createDatabase();
  const audit = createAdminAudit(db);
  const env = { ...process.env, NODE_ENV: 'test', CUSTOMER_AUTH_MODE: 'mock', ENABLE_DEV_LOGIN: 'true', LINE_MESSAGING_MODE: 'disabled', PAYMENT_VERIFICATION_MODE: 'mock', SLIP_STORAGE_MODE: 'local',
    INTEGRATION_SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), EASYSLIP_API_KEY: 'synthetic-env-key',
    EASYSLIP_MERCHANT_ACCOUNTS: JSON.stringify({ 1: { promptpayType: 'PHONE', promptpayId: '0800000001', bankCode: '004', bankNumber: '1234567890' } }),
    LINE_CHANNEL_ID: '', LINE_LIFF_ID: '', LINE_WEBHOOK_SECRET: '', LINE_CHANNEL_SECRET: '', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: '', APP_PUBLIC_URL: '' };
  let providerCalls = 0;
  const integrations = createIntegrationSettings({ db, audit, env, fetchImpl: async (url, options) => {
    providerCalls++; assert.equal(url, 'https://api.easyslip.com/v2/info'); assert.match(options.headers.Authorization, /^Bearer synthetic/);
    return { ok: true, json: async () => ({ success: true, data: { branch: { isActive: true }, account: { email: 'do-not-return@example.invalid' } } }) };
  } });
  const adminAuth = createAdminAuth({ db, audit });
  const app = createApp({ adminAuth, admins: createAdminService({ db, audit }), integrations, checkDatabase: async () => ({ status: 'ok' }) });
  const agent = request.agent(app);
  const login = await agent.post('/api/admin/auth/login').send({ username: 'local_super_admin', password: 'local-admin-only' }).expect(200);
  const actor = login.body.admin;
  const csrf = login.body.csrf_token;
  const read = () => integrations.get();
  const field = (view, name) => view.fields.find((f) => f.name === name);
  const save = async (values, rest = {}) => integrations.update(actor, { version: (await read()).version, values, confirm: true, ...rest });
  try {
    await t.test('all six section PATCH/GET/recreated resolver persist settings without returning secrets', async () => {
      const changes = [
        { PAYMENT_INTEGRATION_ENABLED: 'false', PAYMENT_VERIFICATION_MODE: 'checkslip' },
        { PLATFORM_PROMPTPAY_ENABLED: 'true', PLATFORM_PROMPTPAY_TYPE: 'PHONE', PLATFORM_PROMPTPAY_ID: '0800001111', PLATFORM_PROMPTPAY_NAME: 'Synthetic QA' },
        { EASYSLIP_API_KEY: 'TEST_SECRET_DO_NOT_USE', EASYSLIP_API_BASE_URL: 'https://api.easyslip.com/v2' },
        { CHECKSLIP_API_URL: 'https://example.invalid/verify', CHECKSLIP_API_KEY: 'TEST_SECRET_DO_NOT_USE' },
        { LINE_LOGIN_ENABLED: 'true', LINE_CHANNEL_ID: '1234567890', LINE_LIFF_ID: '1234567890-testqa' },
        { LINE_MESSAGING_MODE: 'mock', LINE_WEBHOOK_ENABLED: 'true', LINE_WEBHOOK_SECRET: 'TEST_SECRET_DO_NOT_USE', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'TEST_SECRET_DO_NOT_USE' },
      ];
      try {
        for (const values of changes) {
          await agent.patch('/api/admin/settings/integrations').set('x-csrf-token', csrf)
            .send({ version: (await read()).version, values, confirm: true }).expect(200);
          const refreshed = await agent.get('/api/admin/settings/integrations').expect(200);
          const restarted = createIntegrationSettings({ db, audit, env });
          const resolved = await restarted.environment();
          for (const [name, value] of Object.entries(values)) {
            assert.equal(resolved[name], value);
            const f = field(refreshed.body, name);
            assert.equal(f.source, 'DATABASE');
            if (f.type === 'secret') { assert.equal(f.configured, true); assert.ok(f.masked); assert.equal(f.value, undefined); }
            else assert.equal(f.value, value);
          }
          assert.doesNotMatch(refreshed.text, /TEST_SECRET_DO_NOT_USE|0800001111/);
        }
        await agent.patch('/api/admin/settings/integrations').set('x-csrf-token', csrf)
          .send({ version: (await read()).version, values: { EASYSLIP_API_KEY: '' }, confirm: true }).expect(200);
        assert.equal((await integrations.environment()).EASYSLIP_API_KEY, 'TEST_SECRET_DO_NOT_USE');
        await agent.patch('/api/admin/settings/integrations').set('x-csrf-token', csrf)
          .send({ version: (await read()).version, values: {}, clear: ['EASYSLIP_API_KEY'], confirm: true }).expect(200);
        assert.equal(field(await read(), 'EASYSLIP_API_KEY').source, 'ENVIRONMENT');
        assert.doesNotMatch(JSON.stringify(await db('audit_logs').where({ entity_type: 'INTEGRATION_SETTINGS' })), /TEST_SECRET_DO_NOT_USE/);
      } finally { await db('integration_settings').delete(); }
    });
    await t.test('development auto key saves encrypted DB secrets and survives service restart', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'food-integration-db-key-'));
      const localEnv = { ...env, NODE_ENV: 'development', INTEGRATION_SETTINGS_ENCRYPTION_KEY: '', INTEGRATION_SETTINGS_KEY_FILE: path.join(directory, 'settings.key') };
      try {
        const first = createIntegrationSettings({ db, audit, env: localEnv });
        const saved = await first.update(actor, { version: 0, values: { EASYSLIP_API_KEY: 'synthetic-persistent-db-secret' } });
        assert.equal(saved.encryption_ready, true);
        assert.equal(saved.encryption_key_source, 'DEVELOPMENT_FILE');
        const stored = await db('integration_settings').first();
        assert.match(stored.secret_values.EASYSLIP_API_KEY, /^v1\./);
        assert.doesNotMatch(JSON.stringify(stored), /synthetic-persistent-db-secret/);
        const restarted = createIntegrationSettings({ db, audit, env: localEnv });
        assert.equal((await restarted.environment()).EASYSLIP_API_KEY, 'synthetic-persistent-db-secret');
        const key = fs.readFileSync(localEnv.INTEGRATION_SETTINGS_KEY_FILE, 'utf8').trim();
        const logs = JSON.stringify(await db('audit_logs').where({ entity_type: 'INTEGRATION_SETTINGS' }));
        assert.ok(!logs.includes(key));
        assert.doesNotMatch(logs, /synthetic-persistent-db-secret/);
      } finally {
        await db('integration_settings').delete(); // disposable schema only (guarded above)
        assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('food-integration-db-key-'));
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
    await t.test('unauthenticated, CSRF and non-super roles denied for GET/update/tests', async () => {
      await request(app).get('/api/admin/settings/integrations').expect(401);
      await agent.patch('/api/admin/settings/integrations').send({ version: 0, values: {} }).expect(403);
      await agent.post('/api/admin/settings/integrations/test').send({}).expect(403);
      const basicAuth = { authenticate: async () => ({ admin: { id: actor.id, role: 'ADMIN' } }), requirePermission: adminAuth.requirePermission };
      const forbidden = createApp({ adminAuth: basicAuth, admins: {}, integrations, checkDatabase: async () => ({ status: 'ok' }) });
      for (const verb of ['get', 'patch', 'post']) {
        await request(forbidden)[verb](`/api/admin/settings/integrations${verb === 'post' ? '/test-easyslip' : ''}`).send({}).expect(403);
      }
      await assert.rejects(integrations.update({ ...actor, role: 'ADMIN' }, { version: 0, values: {} }), /admin_permission_denied/);
    });
    await t.test('Super Admin saves encrypted secret; no read/audit/DB plaintext and no ciphertext in GET', async () => {
      const result = await agent.patch('/api/admin/settings/integrations').set('x-csrf-token', csrf)
        .send({ version: (await read()).version, values: { EASYSLIP_API_KEY: 'synthetic-db-key' } }).expect(200);
      assert.equal(field(result.body, 'EASYSLIP_API_KEY').source, 'DATABASE');
      assert.equal(result.headers['cache-control'], 'no-store');
      const row = await db('integration_settings').first();
      assert.match(row.secret_values.EASYSLIP_API_KEY, /^v1\./);
      assert.doesNotMatch(JSON.stringify(row), /synthetic-db-key/);
      assert.doesNotMatch(JSON.stringify(result.body), /synthetic-db-key|synthetic-env-key|secret_values|ciphertext|authTag|v1\./);
      assert.equal((await integrations.environment()).EASYSLIP_API_KEY, 'synthetic-db-key');
      const logs = await db('audit_logs').where({ entity_type: 'INTEGRATION_SETTINGS' });
      assert.doesNotMatch(JSON.stringify(logs), /synthetic-db-key|synthetic-env-key/);
      assert.ok(logs.some((log) => log.metadata.changes?.[0].new_configured === true));
    });
    await t.test('reveal requires live Super Admin session, CSRF and password; allowlist, rate limit and audit are safe', async (revealTest) => {
      const base = '/api/admin/settings/integrations/secrets/';
      const endpoint = `${base}EASYSLIP_API_KEY/reveal`;
      const logs = [];
      for (const method of ['log', 'warn', 'error']) revealTest.mock.method(console, method, (...args) => logs.push(args));
      let time = Date.now();
      const protectedAuth = createAdminAuth({ db, audit, now: () => time });
      const protectedApp = createApp({ adminAuth: protectedAuth, admins: {}, integrations });
      const cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
      const post = (url = endpoint, password = 'local-admin-only') => request(protectedApp).post(url).set('Cookie', cookie).set('x-csrf-token', csrf).send({ password });
      await request(protectedApp).post(endpoint).send({ password: 'local-admin-only' }).expect(401);
      await request(protectedApp).post(endpoint).set('Cookie', cookie).send({ password: 'local-admin-only' }).expect(403);
      const basicAuth = { authenticate: async () => ({ admin: { id: actor.id, role: 'ADMIN' } }), requirePermission: adminAuth.requirePermission };
      await request(createApp({ adminAuth: basicAuth, admins: {}, integrations })).post(endpoint).send({ password: 'local-admin-only' }).expect(403);
      const wrong = await post(endpoint, 'incorrect-password').expect(401);
      assert.equal(wrong.body.message, 'รหัสผ่านไม่ถูกต้อง');
      assert.equal(wrong.headers['cache-control'], 'no-store');
      for (const key of ['DB_PASSWORD', 'INTEGRATION_SETTINGS_ENCRYPTION_KEY', 'PLATFORM_PROMPTPAY_ID']) {
        await post(`${base}${key}/reveal`).expect(400);
      }
      const absent = await post(`${base}CHECKSLIP_API_KEY/reveal`).expect(404);
      assert.doesNotMatch(absent.text, /synthetic-env/);
      await post().expect(429); // successes/failures share one admin-scoped limit
      time += 15 * 60 * 1000 + 1;
      const keys = ['EASYSLIP_API_KEY', 'CHECKSLIP_API_KEY', 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_WEBHOOK_SECRET'];
      await save(Object.fromEntries(keys.slice(1).map((name) => [name, 'synthetic-reveal-only'])));
      const settingsBefore = await db('integration_settings').first();
      const auditBefore = await db('audit_logs').where({ action: 'SECRET_REVEALED' }).count('* as n').first();
      for (const key of keys) {
        const result = await post(`${base}${key}/reveal`).expect(200);
        assert.deepEqual(result.body, { value: key === 'EASYSLIP_API_KEY' ? 'synthetic-db-key' : 'synthetic-reveal-only' });
        assert.equal(result.headers['cache-control'], 'no-store');
        assert.equal(result.headers.pragma, 'no-cache');
      }
      await post().expect(429);
      assert.deepEqual(await db('integration_settings').first(), settingsBefore);
      const events = await db('audit_logs').where({ action: 'SECRET_REVEALED' }).orderBy('id', 'desc');
      assert.equal(events.length, Number(auditBefore.n) + 5);
      for (const event of events.slice(0, 5)) {
        assert.equal(String(event.actor_id), String(actor.id)); assert.ok(event.created_at);
        assert.ok(keys.includes(event.metadata.setting));
        assert.deepEqual(Object.keys(event.metadata).sort(), ['setting', 'version']);
      }
      const normal = await agent.get('/api/admin/settings/integrations').expect(200);
      assert.equal(field(normal.body, 'EASYSLIP_API_KEY').revealable, true);
      assert.doesNotMatch(JSON.stringify([normal.body, events, logs, settingsBefore]), /synthetic-db-key|synthetic-reveal-only|local-admin-only/);
      // Revoked/expired sessions cannot reveal even with the correct password.
      const expired = createApp({ adminAuth: createAdminAuth({ db, audit, now: () => Date.now() + 11 * 3600000 }), admins: {}, integrations });
      const another = request.agent(protectedApp);
      const otherLogin = await another.post('/api/admin/auth/login').send({ username: 'local_super_admin', password: 'local-admin-only' }).expect(200);
      const otherCookie = otherLogin.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
      await request(expired).post(endpoint).set('Cookie', otherCookie).set('x-csrf-token', otherLogin.body.csrf_token).send({ password: 'local-admin-only' }).expect(401);
      await another.post(endpoint).set('x-csrf-token', otherLogin.body.csrf_token).send({ password: 'local-admin-only' }).expect(401);
      await save({}, { clear: keys.slice(1) });
    });
    await t.test('blank/omitted secret preserved; masking cannot replace value; explicit clear falls back to ENV', async () => {
      await save({ EASYSLIP_API_KEY: '' }); await save({});
      assert.equal((await integrations.environment()).EASYSLIP_API_KEY, 'synthetic-db-key');
      await assert.rejects(save({ EASYSLIP_API_KEY: '••••••••' }), /invalid_integration_secret/);
      await assert.rejects(save({ EASYSLIP_API_KEY: 'line\nbreak' }), /invalid_integration_value/);
      await assert.rejects(save({}, { clear: ['EASYSLIP_API_KEY'], confirm: false }), /confirmation_required/);
      const result = await save({}, { clear: ['EASYSLIP_API_KEY'] });
      assert.equal(field(result, 'EASYSLIP_API_KEY').source, 'ENVIRONMENT');
      assert.equal((await integrations.environment()).EASYSLIP_API_KEY, 'synthetic-env-key');
    });
    await t.test('version conflict and concurrent writes cannot silently overwrite', async () => {
      const version = (await read()).version;
      const results = await Promise.allSettled(['synthetic-one', 'synthetic-two'].map((value) => integrations.update(actor, { version, values: { EASYSLIP_API_KEY: value } })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
    });
    await t.test('disabled payment blocks new operations but keeps historical payment reads available without a provider key', async () => {
      await save({ PAYMENT_INTEGRATION_ENABLED: 'false', PAYMENT_VERIFICATION_MODE: 'checkslip' });
      const runtime = createIntegrationRuntime({ integrations, db, storage: {}, storageConfig: {} });
      const order = await db('orders').first('id', 'customer_id');
      assert.ok(order);
      await assert.rejects(runtime.payments.createAttempt(order.customer_id, order.id), /payment_integration_disabled/);
      await runtime.payments.getPayment(order.customer_id, order.id);
      await save({ PAYMENT_INTEGRATION_ENABLED: 'true', PAYMENT_VERIFICATION_MODE: 'mock' });
    });
    await t.test('DB payment config overrides ENV; rotation effective immediately; missing config cannot activate', async () => {
      await save({ PAYMENT_VERIFICATION_MODE: 'easyslip' });
      assert.equal((await integrations.getPaymentIntegrationConfig()).config.verificationMode, 'easyslip');
      await save({ EASYSLIP_API_KEY: 'synthetic-rotated-key' });
      assert.equal((await integrations.getPaymentIntegrationConfig()).config.easyslipApiKey, 'synthetic-rotated-key');
      const missing = createIntegrationSettings({ db, audit, env: { ...env, EASYSLIP_API_KEY: '' } });
      await assert.rejects(missing.update(actor, { version: (await read()).version, values: {}, clear: ['EASYSLIP_API_KEY'], confirm: true }), { code: 'integration_configuration_incomplete' });
      await save({ PAYMENT_VERIFICATION_MODE: 'mock' });
    });
    await t.test('PromptPay stored privately but never changes existing merchant recipient', async () => {
      const merchants = await db('merchants').select('id', 'promptpay_id');
      await assert.rejects(save({ PLATFORM_PROMPTPAY_ID: '123' }), { code: 'integration_configuration_incomplete' });
      const result = await save({ PLATFORM_PROMPTPAY_ID: '0800001111', PLATFORM_PROMPTPAY_TYPE: 'PHONE', PLATFORM_PROMPTPAY_NAME: 'Synthetic platform', PLATFORM_PROMPTPAY_ENABLED: 'true' });
      assert.equal(result.status.promptpay.wired_to_payment, false);
      assert.equal(field(result, 'PLATFORM_PROMPTPAY_ID').masked, '******1111');
      assert.doesNotMatch(JSON.stringify(result), /0800001111/);
      assert.deepEqual(await db('merchants').select('id', 'promptpay_id'), merchants);
    });
    await t.test('LINE IDs resolve; webhook and Messaging use rotated secret/token without restart', async () => {
      await save({ LINE_CHANNEL_ID: '1234567890', LINE_LIFF_ID: '1234567890-abcdef', LINE_WEBHOOK_SECRET: 'synthetic-webhook-1', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-token-1', LINE_MESSAGING_MODE: 'real' });
      const sent = [];
      const runtime = createIntegrationRuntime({ integrations, db, storage: {}, storageConfig: {}, messagingDependencies: { fetchImpl: async (_url, options) => { sent.push(options.headers.Authorization); return { ok: true }; } } });
      const auth = await runtime.resolveCustomerConfig();
      assert.equal(auth.lineChannelId, '1234567890'); assert.equal(auth.liffId, '1234567890-abcdef');
      await runtime.messaging.push('U_SYNTHETIC', {});
      const body = Buffer.from('{"events":[]}');
      await runtime.webhook.handle(body, signatureFor('synthetic-webhook-1', body));
      await save({ LINE_WEBHOOK_SECRET: 'synthetic-webhook-2', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-token-2' });
      await assert.rejects(runtime.webhook.handle(body, signatureFor('synthetic-webhook-1', body)), /invalid_line_signature/);
      await runtime.webhook.handle(body, signatureFor('synthetic-webhook-2', body));
      await runtime.messaging.push('U_SYNTHETIC', {});
      assert.deepEqual(sent, ['Bearer synthetic-token-1', 'Bearer synthetic-token-2']);
      assert.doesNotMatch(JSON.stringify(await read()), /synthetic-token|synthetic-webhook/);
    });
    await t.test('LINE Login uses resolved audience and disabled login is enforced server-side', async () => {
      const runtime = createIntegrationRuntime({ integrations, db, storageConfig: {} });
      const calls = [];
      const auth = createCustomerAuth({ db, config: { mode: 'line' }, resolveConfig: async () => ({ ...await runtime.resolveCustomerConfig(), mode: 'line' }),
        identityProvider: { verifyIdToken: async (_token, aud) => { calls.push(aud); return { iss: 'https://access.line.me', aud, sub: 'U_LOCAL_CUSTOMER_001', exp: Math.floor(Date.now() / 1000) + 60 }; } } });
      await auth.loginLineCustomer('synthetic-id-token');
      await save({ LINE_CHANNEL_ID: '9876543210' });
      await auth.loginLineCustomer('synthetic-id-token');
      assert.deepEqual(calls, ['1234567890', '9876543210']);
      await save({ LINE_LOGIN_ENABLED: 'false' });
      await assert.rejects(auth.loginLineCustomer('synthetic-id-token'), /line_login_disabled/);
      await save({ LINE_WEBHOOK_ENABLED: 'false', LINE_MESSAGING_MODE: 'disabled' });
      await assert.rejects(runtime.webhook.handle(Buffer.from('{}'), 'invalid'), /webhook_disabled/);
    });
    await t.test('configuration-only tests do not call provider; explicit account test returns no provider body', async () => {
      assert.equal(providerCalls, 0);
      assert.equal((await integrations.testConfiguration(actor)).real_verification, 'NOT_VERIFIED');
      assert.equal(providerCalls, 0);
      await assert.rejects(integrations.testEasyslip(actor, {}), /confirmation_required/);
      const result = await integrations.testEasyslip(actor, { confirmRealRequest: true, version: (await read()).version });
      assert.equal(providerCalls, 1); assert.equal(result.result, 'ACCOUNT_AUTH_VERIFIED');
      assert.doesNotMatch(JSON.stringify(result), /do-not-return|synthetic/);
      assert.equal((await read()).status.easyslip.real_verification, 'NOT_VERIFIED');
    });
    await t.test('account endpoint normalizes success/auth failures/timeouts without leaking provider details', async () => {
      const cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
      const paymentBefore = await db('payments').select('*').orderBy('id');
      const settingsBefore = await db('integration_settings').first();
      for (const scenario of [
        { status: 200, data: { success: true, data: { branch: { isActive: true }, secret: 'TEST_SECRET_DO_NOT_USE' } }, result: 'ACCOUNT_AUTH_VERIFIED', code: null },
        { status: 401, code: 'INVALID_API_KEY' }, { status: 403, code: 'INVALID_API_KEY' },
        { status: 429, code: 'PROVIDER_UNAVAILABLE' }, { status: 500, code: 'PROVIDER_UNAVAILABLE' },
        { error: Object.assign(new Error('TEST_SECRET_DO_NOT_USE'), { name: 'TimeoutError' }), code: 'PROVIDER_UNAVAILABLE' },
        { status: 200, invalidJson: true, code: 'PROVIDER_UNAVAILABLE' },
        { status: 200, data: {}, code: 'INVALID_RESPONSE' },
        { status: 200, data: { success: true, data: { branch: { isActive: false } } }, code: 'ACCOUNT_INACTIVE' },
      ]) {
        let calls = 0;
        const tested = createIntegrationSettings({ db, audit, env, fetchImpl: async (url, options) => {
          calls++; assert.equal(url, 'https://api.easyslip.com/v2/info'); assert.equal(options.method, 'GET');
          assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
          assert.match(options.headers.Authorization, /^Bearer synthetic/);
          if (scenario.error) throw scenario.error;
          return { status: scenario.status, ok: scenario.status === 200, json: async () => {
            assert.equal(scenario.status, 200, 'do not inspect error provider payload');
            if (scenario.invalidJson) throw new Error('TEST_SECRET_DO_NOT_USE'); return scenario.data;
          } };
        } });
        const testedApp = createApp({ adminAuth, admins: {}, integrations: tested, checkDatabase: async () => ({ status: 'ok' }) });
        const response = await request(testedApp).post('/api/admin/settings/integrations/test-easyslip').set('Cookie', cookie).set('x-csrf-token', csrf)
          .send({ version: settingsBefore.version, confirmRealRequest: true }).expect(200);
        assert.equal(calls, 1); assert.equal(response.body.result, scenario.result || 'NOT_VERIFIED');
        assert.equal(response.body.failure_code, scenario.code); assert.equal(response.body.slip_verification, 'NOT_VERIFIED');
        assert.doesNotMatch(response.text, /TEST_SECRET_DO_NOT_USE|Bearer|synthetic|stack|Authorization/);
      }
      assert.deepEqual(await db('integration_settings').first(), settingsBefore, 'account verification is not persisted');
      assert.deepEqual(await db('payments').select('*').orderBy('id'), paymentBefore);
      assert.doesNotMatch(JSON.stringify(await db('audit_logs').where({ entity_type: 'INTEGRATION_SETTINGS' })), /TEST_SECRET_DO_NOT_USE|Bearer/);
      await save({}, { clear: ['EASYSLIP_API_KEY'] });
      let calls = 0;
      const missing = createIntegrationSettings({ db, audit, env: { ...env, EASYSLIP_API_KEY: '' }, fetchImpl: async () => { calls++; } });
      await assert.rejects(missing.testEasyslip(actor, { version: (await read()).version, confirmRealRequest: true }), { code: 'easyslip_api_key_missing' });
      const missingApp = createApp({ adminAuth, admins: {}, integrations: missing, checkDatabase: async () => ({ status: 'ok' }) });
      const missingResponse = await request(missingApp).post('/api/admin/settings/integrations/test-easyslip').set('Cookie', cookie).set('x-csrf-token', csrf)
        .send({ version: (await read()).version, confirmRealRequest: true }).expect(422);
      assert.equal(missingResponse.body.code, 'easyslip_api_key_missing');
      assert.equal(calls, 0);
      await save({ EASYSLIP_API_KEY: 'synthetic-restored-key' });
    });
    await t.test('wrong key fails safely, source clear/default and production mock guards stay intact', async () => {
      const wrong = createIntegrationSettings({ db, audit, env: { ...env, INTEGRATION_SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') } });
      await assert.rejects(wrong.environment(), /integration_decryption_failed/);
      const production = createIntegrationSettings({ db, audit, env: { ...env, NODE_ENV: 'production', CUSTOMER_AUTH_MODE: 'line', ENABLE_DEV_LOGIN: 'false' } });
      await assert.rejects(production.update(actor, { version: (await read()).version, values: { PAYMENT_VERIFICATION_MODE: 'mock' }, confirm: true }), { code: 'integration_configuration_incomplete' });
      await assert.rejects(save({ LINE_LIFF_ID: 'not-a-liff' }), /invalid_liff_id/);
      await assert.rejects(save({ CHECKSLIP_API_URL: 'http://unsafe.invalid' }), /invalid_integration_url/);
      assert.equal((await read()).webhook_url, null);
      const publicSettings = createIntegrationSettings({ db, audit, env: { ...env, APP_PUBLIC_URL: 'https://app.example.invalid' } });
      assert.equal((await publicSettings.get()).webhook_url, 'https://app.example.invalid/api/webhooks/line');
      const absent = createIntegrationSettings({ db, audit, env: { ...env, INTEGRATION_SETTINGS_ENCRYPTION_KEY: '' } });
      await assert.rejects(absent.environment(), /integration_encryption_unavailable/);
    });
  } finally {
    await db('integration_settings').delete();
    await db.destroy();
  }
});
