const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
require('../src/env.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createIntegrationSettings } = require('../src/integration-settings.cjs');
const { createIntegrationRuntime } = require('../src/integration-runtime.cjs');
const { createAdminAuth } = require('../src/admin-auth.cjs');
const { createAdminAudit } = require('../src/admin-audit.cjs');
const { createApp } = require('../src/app.cjs');
const { createOrderService } = require('../src/order-service.cjs');

test('merchant recipient configuration, authority and payment regression', { skip: !/^-c search_path=p0_test_[a-f0-9]{16}$/.test(process.env.PGOPTIONS || '') }, async (t) => {
  const root = createDatabase();
  const db = await root.transaction();
  const audit = createAdminAudit(db);
  const a = await db('merchants').where({ prefix: 'LOC' }).first();
  const b = await db('merchants').whereNot({ id: a.id }).whereNull('deleted_at').first();
  const mapping = (m, number) => ({ promptpayType: m.promptpay_identifier_type, promptpayId: m.promptpay_id, bankCode: '999', bankNumber: number });
  const env = { ...process.env, NODE_ENV: 'test', CUSTOMER_AUTH_MODE: 'mock', ENABLE_DEV_LOGIN: 'true', SLIP_STORAGE_MODE: 'local',
    LINE_MESSAGING_MODE: 'disabled', PAYMENT_VERIFICATION_MODE: 'easyslip', EASYSLIP_API_KEY: 'synthetic-key',
    INTEGRATION_SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    EASYSLIP_MERCHANT_ACCOUNTS: JSON.stringify({ [a.id]: mapping(a, '0000000011'), [b.id]: mapping(b, '0000000022') }) };
  const settings = createIntegrationSettings({ db, audit, env });
  const auth = createAdminAuth({ db, audit });
  const app = createApp({ adminAuth: auth, admins: {}, integrations: settings });
  const agent = request.agent(app);
  const login = await agent.post('/api/admin/auth/login').send({ username: 'local_super_admin', password: 'local-admin-only' }).expect(200);
  const csrf = login.body.csrf_token;
  const actor = login.body.admin;
  const endpoint = (id = a.id) => `/api/admin/merchants/${id}/payment-recipient`;
  const save = async (values = {}, id = a.id) => agent.patch(endpoint(id)).set('x-csrf-token', csrf)
    .send({ version: (await settings.get()).version, bankCode: '999', bankNumber: '0000000033', enabled: true, confirm: true, ...values });
  try {
    await db('integration_settings').delete();
    await t.test('Super Admin saves encrypted override, masked GET and safe audit; readiness reflects merchant QR', async () => {
      const initial = await agent.get(endpoint()).expect(200); assert.equal(initial.body.source, 'ENVIRONMENT');
      const result = await save(); assert.equal(result.status, 200); assert.equal(result.body.source, 'DATABASE'); assert.equal(result.body.configured, true);
      assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.body.bank_number_masked, '******0033');
      const row = await db('integration_settings').first(); assert.match(row.secret_values[`MERCHANT_RECIPIENT_${a.id}`], /^v1\./);
      const logs = await db('audit_logs').where({ action: 'MERCHANT_RECIPIENT_CHANGED' }); assert.equal(String(logs.at(-1).entity_id), String(a.id));
      const normal = await agent.get('/api/admin/settings/integrations').expect(200);
      assert.ok(normal.body.merchant_recipients.configured >= 2);
      for (const number of ['0000000033', '0000000011', a.promptpay_id]) assert.ok(!JSON.stringify([result.body, row, logs, normal.body]).includes(number));
      const config = (await settings.getPaymentIntegrationConfig()).config;
      assert.equal(config.easyslipMerchantAccounts[a.id].bankNumber, '0000000033');
      assert.equal(config.easyslipMerchantAccounts[b.id].bankNumber, '0000000022');
      assert.equal((await db('merchants').where({ id: a.id }).first()).promptpay_id, a.promptpay_id);
    });
    await t.test('RBAC, CSRF, merchant ID ownership and payload allowlist block bypass', async () => {
      await request(app).get(endpoint()).expect(401);
      await agent.patch(endpoint()).send({}).expect(403);
      for (const role of ['ADMIN', 'FINANCE', 'SUPPORT', 'MANAGER', 'RIDER']) {
        const restricted = createApp({ adminAuth: { authenticate: async () => ({ admin: { id: actor.id, role } }), requirePermission: auth.requirePermission }, admins: {}, integrations: settings });
        await request(restricted).get(endpoint()).expect(403); await request(restricted).patch(endpoint(b.id)).send({}).expect(403);
      }
      await agent.get(endpoint(999999999)).expect(404);
      assert.equal((await save({}, 999999999)).status, 404);
      for (const values of [{ merchantId: b.id }, { promptpayId: b.promptpay_id }, { bankNumber: '******0033' }, { bankCode: '9' }, { bankNumber: 'abc' }]) assert.equal((await save(values)).status, 400);
      const config = (await settings.getPaymentIntegrationConfig()).config;
      assert.equal(config.easyslipMerchantAccounts[b.id].bankNumber, '0000000022');
      await assert.rejects(settings.reveal(actor, `MERCHANT_RECIPIENT_${a.id}`), { code: 'secret_not_revealable' });
    });
    await t.test('blank preserves; disable overrides ENV; clear restores ENV; conflict cannot overwrite', async () => {
      assert.equal((await save({ bankNumber: '' })).status, 200);
      assert.equal((await settings.getPaymentIntegrationConfig()).config.easyslipMerchantAccounts[a.id].bankNumber, '0000000033');
      assert.equal((await save({ bankNumber: '', enabled: false })).body.configured, false);
      assert.equal((await settings.getPaymentIntegrationConfig()).config.easyslipMerchantAccounts[a.id], undefined);
      assert.equal((await save({ clear: true })).body.source, 'ENVIRONMENT');
      assert.equal((await settings.getPaymentIntegrationConfig()).config.easyslipMerchantAccounts[a.id].bankNumber, '0000000011');
      assert.equal((await save()).status, 200);
      const stale = (await settings.get()).version - 1;
      assert.equal((await save({ version: stale })).status, 409);
      const restarted = createIntegrationSettings({ db, audit, env });
      assert.equal((await restarted.getPaymentIntegrationConfig()).config.easyslipMerchantAccounts[a.id].bankNumber, '0000000033');
    });
    await t.test('actual order merchant determines recipient; wrong bank rejected, no mapping fails before provider/storage, match pays', async () => {
      const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
      const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first();
      const item = await db('menu_items').where({ merchant_id: a.id, name: 'Local Basil Rice' }).first();
      const mild = await db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id').where({ 'g.menu_item_id': item.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
      const orders = createOrderService(db);
      const create = () => orders.createOrder(customer.id, { merchantId: Number(a.id), addressId: Number(address.id), deliveryType: 'DELIVERY', items: [{ menuItemId: Number(item.id), quantity: 1, optionChoiceIds: [Number(mild.id)] }] });
      let calls = 0, writes = 0, expectedAmount, wrong = true;
      const runtime = createIntegrationRuntime({ integrations: settings, db, storageConfig: {}, storage: {
        put: async ({ buffer }) => { writes++; return { objectKey: `slips/${crypto.randomUUID()}.png`, fileHash: crypto.createHash('sha256').update(buffer).digest('hex') }; }, remove: async () => {},
      }, verifierDependencies: { request: async () => {
        calls++;
        const account = wrong ? '0000000022' : '0000000033';
        return { statusCode: 200, body: JSON.stringify({ success: true, data: { isDuplicate: false, isAmountMatched: true,
          amountInOrder: expectedAmount, amountInSlip: expectedAmount, matchedAccount: { bank: { code: '999' }, bankNumber: account },
          rawSlip: { transRef: `RECIPIENT-${crypto.randomUUID()}`, date: new Date().toISOString(), amount: { amount: expectedAmount }, receiver: { bank: { id: '999' }, account: { bank: { account } } } } } }) };
      } } });
      for (const outcome of ['mismatch', 'absent', 'match']) {
        const order = await create(); expectedAmount = order.total_amount;
        await runtime.payments.createAttempt(customer.id, order.id);
        const before = { calls, writes };
        if (outcome === 'absent') await save({ enabled: false });
        if (outcome === 'match') { await save(); wrong = false; }
        const action = () => runtime.payments.uploadAndVerify(customer.id, order.id, { mimetype: 'image/png', buffer: Buffer.from(`synthetic-${outcome}`) }, { merchantId: b.id, expectedRecipient: b.promptpay_id });
        if (outcome === 'absent') {
          await assert.rejects(action(), { code: 'payment_recipient_not_configured', message: 'ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน' });
          assert.deepEqual({ calls, writes }, before);
          assert.equal((await db('orders').where({ id: order.id }).first()).payment_status, 'UNPAID');
        } else {
          const { payment: result } = await action(); assert.equal(result.status, outcome === 'match' ? 'PAID' : 'FAILED');
          if (outcome === 'mismatch') assert.equal(result.verification.failure_code, 'RECIPIENT_MISMATCH');
        }
      }
    });
    await t.test('no ENV and no DB mapping is not ready; changing QR invalidates mapping without rewriting history', async () => {
      const noEnv = createIntegrationSettings({ db, audit, env: { ...env, EASYSLIP_MERCHANT_ACCOUNTS: '' } });
      assert.equal((await noEnv.recipients.get(b.id)).configured, false);
      await db('merchants').where({ id: a.id }).update({ promptpay_id: '0800000099' });
      assert.equal((await settings.recipients.get(a.id)).configured, false);
    });
  } finally { await db.rollback(); await root.destroy(); }
});
