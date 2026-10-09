const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createAdminAudit } = require('../src/admin-audit.cjs');
const { createAdminAuth } = require('../src/admin-auth.cjs');
const { createAdminService } = require('../src/admin-service.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';

test('admin backoffice auth, RBAC, CSRF, management and safe reporting', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const audit = createAdminAudit(db);
  const auth = createAdminAuth({ db, audit, secureCookie: false });
  const admins = createAdminService({
    db, audit,
    config: { lineChannelId: '', lineMessagingMode: 'disabled', lineWebhookConfigured: false, checkslipConfigured: false, paymentMode: 'mock', storageMode: 'local' },
  });
  const bannerObjects = new Map();
  const storage = {
    async put({ buffer, contentType, namespace }) {
      assert.equal(namespace, 'banners');
      const objectKey = 'banners/2026/10/12345678-1234-4123-8123-123456789abc.png';
      bannerObjects.set(objectKey, { buffer, contentType });
      return { objectKey };
    },
    async read(objectKey) {
      const result = bannerObjects.get(objectKey);
      if (!result) throw new Error('missing test banner');
      return result;
    },
  };
  const app = createApp({ checkDatabase: createDatabaseProbe(db), adminAuth: auth, admins, storage });
  const agent = request.agent(app);
  const created = { admins: [], banners: [], promotions: [], sois: [], dormitories: [] };
  const auditStart = Number((await db('audit_logs').max('id as id').first()).id || 0);
  const sessionStart = Number((await db('platform_admin_sessions').max('id as id').first()).id || 0);
  const initialSetting = await db('system_settings').where({ setting_key: 'platform_display_name' }).first();
  let csrf;
  let superAdmin;
  let merchant;
  let merchantBefore;
  try {
    await t.test('login is generic, creates isolated cookies and enforces CSRF', async () => {
      const invalid = await agent.post('/api/admin/auth/login').send({ username: 'local_super_admin', password: 'wrong-password' }).expect(401);
      assert.equal(invalid.body.code, 'invalid_admin_credentials');
      const login = await agent.post('/api/admin/auth/login').send({ username: 'local_super_admin', password: 'local-admin-only' }).expect(200);
      csrf = login.body.csrf_token;
      superAdmin = login.body.admin;
      assert.equal(superAdmin.role, 'SUPER_ADMIN');
      assert.ok(login.headers['set-cookie'].some((cookie) => cookie.startsWith('admin_session=') && cookie.includes('HttpOnly')));
      assert.ok(login.headers['set-cookie'].some((cookie) => cookie.startsWith('admin_csrf=')));
      await agent.get('/api/admin/auth/me').expect(200);
      merchant = (await agent.get('/api/admin/merchants').expect(200)).body.items[0];
      merchantBefore = await db('merchants').where({ id: merchant.id }).first();
      await agent.post(`/api/admin/merchants/${merchant.id}/suspend`).send({ reason: 'test' }).expect(403);
    });

    await t.test('dashboard and all read-only global views are bounded and redact sensitive fields', async () => {
      const dashboard = await agent.get('/api/admin/dashboard').expect(200);
      assert.ok(dashboard.body.metrics);
      const customers = await agent.get('/api/admin/customers?limit=2').expect(200);
      assert.ok(customers.body.pagination.total >= 1);
      assert.ok(customers.body.items[0].line_linked);
      await agent.get(`/api/admin/customers/${customers.body.items[0].id}`).expect(200);
      assert.equal((await agent.get('/api/admin/orders?limit=20').expect(200)).body.items.length <= 20, true);
      const payments = await agent.get('/api/admin/payments?limit=20').expect(200);
      assert.equal(JSON.stringify(payments.body).includes('provider_response'), false);
      await agent.get('/api/admin/reports').expect(200);
      const status = await agent.get('/api/admin/system-status').expect(200);
      assert.equal(JSON.stringify(status.body).match(/password|access.?key|channel.?secret/gi), null);
    });

    await t.test('accounting reports recognize only completed and paid net order totals', async () => {
      const orderIds = [];
      try {
        const beforeReport = await admins.reports();
        const beforeDashboard = await admins.dashboard();
        const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first('id');
        const store = await db('merchants').where({ prefix: 'LOC' }).first('id');
        const unique = Number((await db('orders').where({ merchant_id: store.id }).max('merchant_order_number as number').first()).number || 0) + 1;
        const [completed, pending] = await db('orders').insert([
          { order_code: `ADMIN-ACCOUNTING-COMPLETED-${unique}`, merchant_order_number: unique, customer_id: customer.id, merchant_id: store.id, delivery_type: 'PICKUP', status: 'COMPLETED', payment_method: 'PROMPTPAY', payment_status: 'PAID', subtotal_amount: 100, delivery_fee: 0, discount_amount: 0, total_amount: 100, completed_at: db.fn.now() },
          { order_code: `ADMIN-ACCOUNTING-PENDING-${unique}`, merchant_order_number: unique + 1, customer_id: customer.id, merchant_id: store.id, delivery_type: 'PICKUP', status: 'PENDING', payment_method: 'PROMPTPAY', payment_status: 'PAID', subtotal_amount: 200, delivery_fee: 0, discount_amount: 0, total_amount: 200 },
        ]).returning('id');
        orderIds.push(completed.id, pending.id);
        await db('order_items').insert([
          { order_id: completed.id, merchant_id: store.id, item_name: 'Accounting completed item', quantity: 1, unit_price: 100 },
          { order_id: pending.id, merchant_id: store.id, item_name: 'Accounting pending item', quantity: 1, unit_price: 200 },
        ]);
        const afterReport = await admins.reports();
        const afterDashboard = await admins.dashboard();
        assert.equal(Number(afterReport.summary.orders) - Number(beforeReport.summary.orders), 2);
        assert.equal(Number(afterReport.summary.gross) - Number(beforeReport.summary.gross), 100);
        assert.equal(Number(afterDashboard.metrics.paid_orders) - Number(beforeDashboard.metrics.paid_orders), 2);
        assert.equal(Number(afterDashboard.metrics.revenue) - Number(beforeDashboard.metrics.revenue), 100);
        assert.ok(afterReport.top_items.some((item) => item.item_name === 'Accounting completed item'));
        assert.equal(afterReport.top_items.some((item) => item.item_name === 'Accounting pending item'), false);
      } finally {
        if (orderIds.length) {
          await db('order_items').whereIn('order_id', orderIds).delete();
          await db('orders').whereIn('id', orderIds).delete();
        }
      }
    });

    await t.test('merchant suspension is distinct from open state and creates append-only audit', async () => {
      const before = await db('merchants').where({ id: merchant.id }).first();
      const suspended = await agent.post(`/api/admin/merchants/${merchant.id}/suspend`).set('X-CSRF-Token', csrf)
        .send({ reason: 'Local integration test' }).expect(200);
      assert.equal(suspended.body.merchant.is_active, false);
      assert.equal(suspended.body.merchant.is_open, before.is_open);
      await agent.post(`/api/admin/merchants/${merchant.id}/activate`).set('X-CSRF-Token', csrf).send({}).expect(200);
      assert.ok(await db('audit_logs').where({ action: 'MERCHANT_SUSPENDED', entity_id: String(merchant.id) }).first());
    });

    await t.test('global order and payment detail use snapshots, filters and masked references', async () => {
      const trx = await db.transaction();
      try {
        const fixtureAdmins = createAdminService({ db: trx, audit });
        const [customer] = await trx('customers').insert({line_user_id:'U_ADMIN_ORDER_FIXTURE',display_name:'Admin Fixture',is_active:true}).returning('id');
        const merchants = await trx('merchants').orderBy('id').limit(2);
        const ids = [];
        for (const store of merchants) {
          const [order] = await trx('orders').insert({order_code:`ADMIN-FIXTURE-${store.id}`,merchant_order_number:2000000000,customer_id:customer.id,merchant_id:store.id,delivery_type:'PICKUP',payment_method:'PROMPTPAY',subtotal_amount:75,delivery_fee:0,total_amount:75}).returning('id');
          ids.push(order.id);
          await trx('order_items').insert({order_id:order.id,merchant_id:store.id,item_name:'Historical food snapshot',quantity:1,unit_price:75});
        }
        const list = await fixtureAdmins.listOrders({customerId:customer.id});
        assert.equal(list.items.length,2);
        assert.equal((await fixtureAdmins.listOrders({customerId:customer.id,merchantId:merchants[0].id})).items.length,1);
        const detail = await fixtureAdmins.orderDetail(ids[0]);
        assert.equal(detail.items[0].item_name,'Historical food snapshot');
        const [payment] = await trx('payments').insert({order_id:ids[0],method:'PROMPTPAY',status:'PAID',verification_status:'VERIFIED',expected_amount:75,amount_transferred:75,provider:'mock',transaction_reference:'ADMIN-PRIVATE-REFERENCE-1234'}).returning('id');
        const paymentDetail = await fixtureAdmins.paymentDetail(payment.id);
        assert.equal(paymentDetail.transaction_reference,'********1234');
        assert.equal((await fixtureAdmins.listPayments({q:`ADMIN-FIXTURE-${merchants[0].id}`,status:'PAID'})).items.length,1);
      } finally { await trx.rollback(); }
    });

    await t.test('admin users are SUPER_ADMIN-only and last super admin is protected', async () => {
      const createdResponse = await agent.post('/api/admin/users').set('X-CSRF-Token', csrf).send({
        username: 'local_support_test', password: 'local-support-only', fullName: 'Local Support',
        email: 'support@example.invalid', role: 'SUPPORT',
      }).expect(201);
      created.admins.push(createdResponse.body.admin.id);
      assert.equal(createdResponse.body.admin.password_hash, undefined);
      await agent.patch(`/api/admin/users/${superAdmin.id}`).set('X-CSRF-Token', csrf).send({ isActive: false }).expect(409);

      const supportAgent = request.agent(app);
      const supportLogin = await supportAgent.post('/api/admin/auth/login').send({ username: 'local_support_test', password: 'local-support-only' }).expect(200);
      await supportAgent.get('/api/admin/merchants').expect(200);
      const supportCustomers = await supportAgent.get('/api/admin/customers?limit=1').expect(200);
      assert.equal(supportCustomers.body.items[0].line_user_id, undefined);
      await supportAgent.post(`/api/admin/merchants/${merchant.id}/suspend`).set('X-CSRF-Token', supportLogin.body.csrf_token)
        .send({ reason: 'forbidden' }).expect(403);
      await supportAgent.get('/api/admin/users').expect(403);
    });

    await t.test('delivery areas, banners, promotions and settings validate writes and audit them', async () => {
      const soi = await agent.post('/api/admin/delivery-areas/sois').set('X-CSRF-Token', csrf)
        .send({ name: 'Admin Test Soi' }).expect(201);
      created.sois.push(soi.body.soi.id);
      const dorm = await agent.post('/api/admin/delivery-areas/dormitories').set('X-CSRF-Token', csrf)
        .send({ soiId: soi.body.soi.id, name: 'Admin Test Dorm', locationText: 'Local test only' }).expect(201);
      created.dormitories.push(dorm.body.dormitory.id);
      await agent.patch(`/api/admin/delivery-areas/dormitories/${dorm.body.dormitory.id}`).set('X-CSRF-Token', csrf)
        .send({ isActive: false }).expect(200);

      const uploaded = await agent.post('/api/admin/banners/upload').set('X-CSRF-Token', csrf)
        .attach('image', Buffer.from('89504e470d0a1a0a4f424a454354', 'hex'), { filename: 'banner.png', contentType: 'image/png' }).expect(201);
      const banner = await agent.post('/api/admin/banners').set('X-CSRF-Token', csrf).send({
        title: 'Local banner', imageObjectKey: uploaded.body.object_key, scope: 'GLOBAL', merchantId: null,
        targetType: 'NONE', targetValue: null, status: 'PUBLISHED', startsAt: null, endsAt: null, sortOrder: 0,
      }).expect(201);
      created.banners.push(banner.body.banner.id);
      assert.ok((await request(app).get('/api/banners/active').expect(200)).body.banners.some((item) => item.id === banner.body.banner.id));
      await request(app).get(`/api/banners/${banner.body.banner.id}/image`).expect('Content-Type', /image\/png/).expect(200);
      await agent.patch(`/api/admin/banners/${banner.body.banner.id}`).set('X-CSRF-Token', csrf)
        .send({status:'SCHEDULED', startsAt:new Date(Date.now()+3600000)}).expect(200);
      await request(app).get(`/api/banners/${banner.body.banner.id}/image`).expect(404);
      await agent.get(`/api/admin/banners/${banner.body.banner.id}/image`).expect(200);
      await agent.patch(`/api/admin/banners/${banner.body.banner.id}`).set('X-CSRF-Token', csrf)
        .send({status:'PUBLISHED',startsAt:new Date(Date.now()-3600000),endsAt:new Date(Date.now()+3600000)}).expect(200);
      await request(app).get(`/api/banners/${banner.body.banner.id}/image`).expect(200);
      await agent.patch(`/api/admin/banners/${banner.body.banner.id}`).set('X-CSRF-Token', csrf)
        .send({endsAt:new Date(Date.now()-7200000)}).expect(400);
      await agent.patch(`/api/admin/banners/${banner.body.banner.id}`).set('X-CSRF-Token', csrf)
        .send({status:'ARCHIVED'}).expect(200);
      await request(app).get(`/api/banners/${banner.body.banner.id}/image`).expect(404);
      await agent.post('/api/admin/banners/upload').set('X-CSRF-Token', csrf).attach('image',Buffer.from('not an image'),{filename:'bad.png',contentType:'image/png'}).expect(400);

      const start = new Date(Date.now() + 60_000);
      const promotion = await agent.post('/api/admin/promotions').set('X-CSRF-Token', csrf).send({
        name: 'Local percentage', description: 'Management only', merchantId: null, fundingSource: 'MERCHANT', promotionType: 'PERCENTAGE', value: 10,
        minimumOrderAmount: 100, maximumDiscountAmount: 30, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), usageLimit: 100, isActive: true,
      }).expect(201);
      created.promotions.push(promotion.body.promotion.id);
      assert.equal((await agent.get('/api/admin/promotions?status=upcoming&q=Local%20percentage').expect(200)).body.items[0].visibility,'UPCOMING');
      await agent.patch(`/api/admin/promotions/${promotion.body.promotion.id}`).set('X-CSRF-Token',csrf)
        .send({startsAt:new Date(Date.now()-7200000),endsAt:new Date(Date.now()-3600000)}).expect(200);
      assert.equal((await agent.get('/api/admin/promotions?status=expired&q=Local%20percentage').expect(200)).body.items[0].visibility,'EXPIRED');
      await agent.patch(`/api/admin/promotions/${promotion.body.promotion.id}`).set('X-CSRF-Token',csrf).send({isActive:false}).expect(200);
      await agent.post('/api/admin/promotions').set('X-CSRF-Token', csrf).send({
        name: 'Invalid', fundingSource: 'MERCHANT', promotionType: 'PERCENTAGE', value: 101, minimumOrderAmount: 0,
        startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), isActive: true,
      }).expect(400);

      await agent.put('/api/admin/settings/platform_display_name').set('X-CSRF-Token', csrf).send({ value: 'Local Platform', isPublic: true }).expect(200);
      await agent.put('/api/admin/settings/LINE_CHANNEL_SECRET').set('X-CSRF-Token', csrf).send({ value: 'forbidden' }).expect(400);
      assert.ok((await agent.get('/api/admin/audit-logs?limit=100').expect(200)).body.items.length >= 4);
      await agent.delete('/api/admin/audit-logs/1').set('X-CSRF-Token',csrf).expect(404);
      await agent.get('/api/admin/orders?from=invalid').expect(400);
    });

    await t.test('inactive admin cannot authenticate and logout revokes the session', async () => {
      const [inactive] = await db('platform_admins').insert({
        username: 'inactive_admin_test', password_hash: await bcrypt.hash('inactive-admin-only', 12),
        full_name: 'Inactive Admin', role: 'ADMIN', is_active: false,
      }).returning('id');
      created.admins.push(inactive.id);
      await request(app).post('/api/admin/auth/login').send({ username: 'inactive_admin_test', password: 'inactive-admin-only' }).expect(401);
      await agent.post('/api/admin/auth/logout').set('X-CSRF-Token', csrf).expect(204);
      await agent.get('/api/admin/auth/me').expect(401);
    });

    await t.test('failed Admin login is rate limited per IP and username', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await request(app).post('/api/admin/auth/login').send({ username: 'missing_rate_test', password: 'invalid-password' }).expect(401);
      }
      await request(app).post('/api/admin/auth/login').send({ username: 'missing_rate_test', password: 'invalid-password' }).expect(429);
    });
  } finally {
    await db('platform_admin_sessions').where('id', '>', sessionStart).whereIn('admin_id', [superAdmin?.id, ...created.admins].filter(Boolean)).delete();
    if (created.banners.length) await db('banners').whereIn('id', created.banners).delete();
    if (created.promotions.length) await db('promotions').whereIn('id', created.promotions).delete();
    if (created.dormitories.length) await db('dormitories').whereIn('id', created.dormitories).delete();
    if (created.sois.length) await db('sois').whereIn('id', created.sois).delete();
    if (created.admins.length) await db('platform_admins').whereIn('id', created.admins).delete();
    if (initialSetting) await db('system_settings').where({ setting_key: 'platform_display_name' }).update({ setting_value: JSON.stringify(initialSetting.setting_value), is_public: initialSetting.is_public });
    await db('audit_logs').where('id', '>', auditStart).whereIn('actor_id', [superAdmin?.id, ...created.admins].filter(Boolean)).delete();
    if (merchantBefore) await db('merchants').where({ id: merchant.id }).update({ is_active: merchantBefore.is_active, suspended_at: merchantBefore.suspended_at, suspension_reason: merchantBefore.suspension_reason, suspended_by_admin_id: merchantBefore.suspended_by_admin_id });
    await db.destroy();
  }
});
