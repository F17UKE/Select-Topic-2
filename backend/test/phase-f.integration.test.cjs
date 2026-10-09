const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
require('../src/env.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createApp } = require('../src/app.cjs');
const { createCustomerAuth } = require('../src/auth.cjs');
const { createCustomerRepository } = require('../src/customer-repository.cjs');
const { createStoreRepository } = require('../src/store-repository.cjs');
const { createOrderService } = require('../src/order-service.cjs');
const { createPersistentIdempotencyStore } = require('../src/idempotency.cjs');
const { createAdminService } = require('../src/admin-service.cjs');
const { createAdminAudit } = require('../src/admin-audit.cjs');
const { createMerchantStaffAuth } = require('../src/staff-auth.cjs');
const { createMerchantOrderService } = require('../src/merchant-order-service.cjs');
const { calculateDiscount } = require('../src/promotion-service.cjs');

test('promotion integer calculation: percentage, rounding, fixed/caps, free delivery, minimum, zero-pay guard', () => {
  const p = { funding_source: 'MERCHANT', promotion_type: 'PERCENTAGE', value: '12.50', minimum_order_amount: '0.00', maximum_discount_amount: null };
  const amounts = { subtotal: 19999, deliveryFee: 1500, deliveryType: 'DELIVERY' };
  assert.equal(calculateDiscount(p, amounts), 2500);
  assert.equal(calculateDiscount({ ...p, maximum_discount_amount: '20.00' }, amounts), 2000);
  assert.equal(calculateDiscount({ ...p, funding_source: 'MERCHANT', promotion_type: 'FIXED_AMOUNT', value: '50.00' }, amounts), 5000);
  assert.equal(calculateDiscount({ ...p, funding_source: 'MERCHANT', promotion_type: 'FIXED_AMOUNT', value: '999.00' }, amounts), 19999);
  assert.equal(calculateDiscount({ ...p, funding_source: 'MERCHANT', promotion_type: 'FREE_DELIVERY' }, amounts), 1500);
  assert.equal(calculateDiscount({ ...p, funding_source: 'MERCHANT', promotion_type: 'FREE_DELIVERY', maximum_discount_amount: '10.00' }, amounts), 1000);
  assert.throws(() => calculateDiscount({ ...p, minimum_order_amount: '200.00' }, amounts), { code: 'promotion_minimum_not_met' });
  assert.throws(() => calculateDiscount({ ...p, funding_source: 'MERCHANT', promotion_type: 'FREE_DELIVERY' }, { ...amounts, deliveryType: 'PICKUP' }), { code: 'promotion_delivery_only' });
  assert.throws(() => calculateDiscount({ ...p, value: '100.00' }, { ...amounts, deliveryFee: 0 }), { code: 'promotion_zero_total_unsupported' });
});

test('Phase F suspension, promotion transactions and banner publication', {
  skip: !(process.env.DB_HOST === '127.0.0.1' && process.env.DB_NAME === 'select_topic_2_local') && 'local DB required',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const tag = crypto.randomUUID().slice(0, 8);
  const merchantIds = [], promotionIds = [], bannerIds = [], idempotencyKeys = [];
  const audit = createAdminAudit(db);
  const admins = createAdminService({ db, audit, config: {} });
  const orders = createOrderService(db);
  const createAppFor = (service = orders) => createApp({
    checkDatabase: createDatabaseProbe(db),
    auth: createCustomerAuth({ db, config: { mode: 'mock', devLoginEnabled: true, devLineUserId: 'U_LOCAL_CUSTOMER_001', secureCookie: false } }),
    customers: createCustomerRepository(db), stores: createStoreRepository(db), orders: service,
    idempotency: createPersistentIdempotencyStore({ db }),
    admins, adminAuth: {}, storage: { read: async () => ({ buffer: Buffer.from('image'), contentType: 'image/png' }) },
  });
  const app = createAppFor();
  const customerAgent = request.agent(app);
  const create = (payload, agent = customerAgent, key = `phase-f-${crypto.randomUUID()}`) => {
    idempotencyKeys.push(key);
    return agent.post('/api/orders').set('Idempotency-Key', key).send(payload);
  };
  const promo = async (overrides = {}) => {
    const [row] = await db('promotions').insert({ name: `Phase F ${tag}`, funding_source: 'MERCHANT', promotion_type: 'PERCENTAGE', value: '10.00',
      minimum_order_amount: '0.00', starts_at: new Date(Date.now() - 60000), ends_at: new Date(Date.now() + 3600000),
      ...overrides }).returning('*');
    promotionIds.push(row.id); return row;
  };
  try {
    const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
    const address = await db('customer_addresses as a').join('dormitories as d', 'd.id', 'a.dormitory_id')
      .where({ 'a.customer_id': customer.id, 'a.is_default': true }).first('a.id', 'd.soi_id');
    const actor = await db('platform_admins').where({ username: 'local_super_admin' }).first();
    const payloads = [];
    for (let i = 0; i < 2; i++) {
      const [merchant] = await db('merchants').insert({ store_name: `Phase F ${tag} ${i}`, prefix: `F${tag}${i}`, phone: '0800000000', location_text: 'Local test', promptpay_identifier_type: 'PHONE', promptpay_id: '0800000000', is_open: true }).returning('*');
      merchantIds.push(merchant.id);
      const [category] = await db('menu_categories').insert({ merchant_id: merchant.id, name: 'Test' }).returning('id');
      const [item] = await db('menu_items').insert({ merchant_id: merchant.id, category_id: category.id, name: 'Snapshot food', price: '100.00', is_available: true }).returning('id');
      await db('delivery_fees').insert({ merchant_id: merchant.id, soi_id: address.soi_id, fee: '15.00' });
      payloads.push({ merchantId: merchant.id, deliveryType: 'DELIVERY', addressId: address.id, items: [{ menuItemId: item.id, quantity: 2 }] });
    }
    const [staff] = await db('merchant_staffs').insert({ merchant_id: merchantIds[0], username: `f_${tag}`, password_hash: 'DEV_ONLY_NO_PASSWORD_LOGIN', full_name: 'Test manager', role: 'MANAGER', is_active: true }).returning('*');
    await customerAgent.post('/api/dev/auth/login').expect(200);

    await t.test('suspension rejects bypass/quote, preserves history/staff access and activation restores orders; audit records both', async () => {
      const historical = (await create(payloads[0]).expect(201)).body.order;
      await admins.setMerchantActive(actor, merchantIds[0], false, 'Local enforcement test', {});
      assert.equal((await create(payloads[0]).expect(409)).body.error, 'merchant_suspended');
      await customerAgent.post('/api/orders/quote').send(payloads[0]).expect(409);
      const browsing = (await customerAgent.get(`/api/merchants/${merchantIds[0]}`).expect(200)).body.merchant;
      assert.equal(browsing.accepting_orders, false);
      assert.equal(browsing.unavailable_reason, 'merchant_suspended');
      await customerAgent.get(`/api/orders/${historical.id}`).expect(200);
      const auth = createMerchantStaffAuth({ db, config: { mode: 'mock', devLoginEnabled: true, defaultUsername: staff.username, secureCookie: false } });
      // Existing staff remain authorized to fulfill historical orders.
      const merchantService = createMerchantOrderService(db);
      assert.ok((await merchantService.listOrders(staff)).some((order) => order.id === historical.id));
      const staffAgent = request.agent(createApp({ checkDatabase: createDatabaseProbe(db), staffAuth: auth, merchantOrders: merchantService }));
      await staffAgent.post('/api/dev/merchant/auth/login').expect(200);
      await staffAgent.get(`/api/merchant/orders/${historical.id}`).expect(200);
      await admins.setMerchantActive(actor, merchantIds[0], true, null, {});
      await create(payloads[0]).expect(201);
      assert.deepEqual((await db('audit_logs').where({ entity_type: 'MERCHANT', entity_id: String(merchantIds[0]) }).orderBy('id')).map((row) => row.action), ['MERCHANT_SUSPENDED', 'MERCHANT_ACTIVATED']);
    });

    await t.test('percentage/fixed/free-delivery quotes are authoritative, do not redeem, and persist exact snapshots', async () => {
      for (const [type, value, discount] of [['PERCENTAGE', 10, 20], ['FIXED_AMOUNT', 30, 30], ['FREE_DELIVERY', 0, 15]]) {
        const p = await promo({ funding_source: 'MERCHANT', promotion_type: type, value, merchant_id: merchantIds[0] });
        const payload = { ...payloads[0], promotionId: p.id, total: 1, discountAmount: 999 };
        const quote = (await customerAgent.post('/api/orders/quote').send(payload).expect(200)).body.quote;
        assert.equal(quote.discount_amount, discount); assert.equal(quote.total_amount, 215 - discount);
        assert.equal((await db('promotions').where({ id: p.id }).first()).usage_count, 0);
        const order = (await create(payload).expect(201)).body.order;
        assert.equal(order.discount_amount, discount); assert.equal(order.total_amount, quote.total_amount);
        await db('promotions').where({ id: p.id }).update({ name: 'Changed later', value: 0 });
        const snapshot = (await customerAgent.get(`/api/orders/${order.id}`).expect(200)).body.order;
        assert.equal(snapshot.promotion_snapshot.name, p.name);
        assert.equal(snapshot.discount_amount, discount);
        assert.equal(Number((await db('promotion_redemptions').where({ order_id: order.id }).first()).discount_amount), discount);
      }
    });

    await t.test('minimum, future, expired, inactive, wrong scope, cap, and unpublished API eligibility', async () => {
      for (const [override, error] of [
        [{ minimum_order_amount: 201 }, 'promotion_minimum_not_met'],
        [{ starts_at: new Date(Date.now() + 60000) }, 'promotion_unavailable'],
        [{ starts_at: new Date(Date.now() - 120000), ends_at: new Date(Date.now() - 60000) }, 'promotion_unavailable'],
        [{ is_active: false }, 'promotion_unavailable'],
        [{ merchant_id: merchantIds[1] }, 'promotion_wrong_merchant'],
      ]) {
        const p = await promo(override);
        const result = await create({ ...payloads[0], promotionId: p.id }).expect(422);
        assert.equal(result.body.error, error);
        assert.equal((await db('promotions').where({ id: p.id }).first()).usage_count, 0);
      }
      const p = await promo({ value: 50, maximum_discount_amount: 25 });
      assert.equal((await customerAgent.post('/api/orders/quote').send({ ...payloads[0], promotionId: p.id }).expect(200)).body.quote.discount_amount, 25);
      await customerAgent.get(`/api/promotions/${p.id}`).expect(200);
      await request(app).get(`/api/promotions/${p.id}`).expect(401);
    });

    await t.test('global limit serializes across merchants; replay after recreated app consumes once; rollback releases quota', async () => {
      const p = await promo({ usage_limit: 1 });
      const firstKey = `phase-f-${crypto.randomUUID()}`, secondKey = `phase-f-${crypto.randomUUID()}`;
      const results = await Promise.all([create({ ...payloads[0], promotionId: p.id }, customerAgent, firstKey), create({ ...payloads[1], promotionId: p.id }, customerAgent, secondKey)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await db('promotions').where({ id: p.id }).first()).usage_count, 1);
      const index = results[0].status === 201 ? 0 : 1;
      const restarted = request.agent(createAppFor()); await restarted.post('/api/dev/auth/login').expect(200);
      const replay = await create({ ...payloads[index], promotionId: p.id }, restarted, index ? secondKey : firstKey).expect(201);
      assert.equal(replay.body.order.id, results[index].body.order.id);
      assert.equal((await db('promotions').where({ id: p.id }).first()).usage_count, 1);
      const rollbackPromo = await promo({ usage_limit: 1 });
      const failing = createOrderService(db, { beforeCommit: () => { throw new Error('injected rollback'); } });
      await assert.rejects(failing.createOrder(customer.id, { ...payloads[0], promotionId: rollbackPromo.id }));
      assert.equal((await db('promotions').where({ id: rollbackPromo.id }).first()).usage_count, 0);
      assert.equal(Number((await db('promotion_redemptions').where({ promotion_id: rollbackPromo.id }).count('* as count').first()).count), 0);
      await create({ ...payloads[0], promotionId: rollbackPromo.id }).expect(201);
    });

    await t.test('only published in-window banners appear in sort order; draft/scheduled/expired images are private', async () => {
      const rows = [];
      for (const [status, offset, endOffset, sort] of [['PUBLISHED', -60000, 60000, 2], ['PUBLISHED', -60000, 60000, 1], ['DRAFT', -60000, 60000, 0], ['SCHEDULED', -60000, 60000, 0], ['PUBLISHED', 60000, 120000, 0], ['PUBLISHED', -120000, -60000, 0]]) {
        const [row] = await db('banners').insert({ title: `F ${tag}`, image_object_key: 'banners/2026/10/12345678-1234-4123-8123-123456789abc.png', status, sort_order: sort, starts_at: new Date(Date.now() + offset), ends_at: new Date(Date.now() + endOffset) }).returning('*');
        bannerIds.push(row.id); rows.push(row);
      }
      const listed = (await request(app).get('/api/banners/active').expect(200)).body.banners.filter((row) => bannerIds.includes(row.id));
      assert.deepEqual(listed.map((r) => r.id), [rows[1].id, rows[0].id]);
      for (const row of rows.slice(2)) await request(app).get(`/api/banners/${row.id}/image`).expect(404);
      await request(app).get(`/api/banners/${rows[0].id}/image`).expect(200);
    });
  } finally {
    await db('idempotency_keys').whereIn('idempotency_key', idempotencyKeys).delete();
    const ids = (await db('orders').whereIn('merchant_id', merchantIds).select('id')).map((r) => r.id);
    await db('promotion_redemptions').whereIn('order_id', ids).delete();
    await db('order_items').whereIn('order_id', ids).delete();
    await db('orders').whereIn('id', ids).delete();
    await db('banners').whereIn('id', bannerIds).delete();
    await db('promotions').whereIn('id', promotionIds).delete();
    await db('audit_logs').where({ entity_type: 'MERCHANT' }).whereIn('entity_id', merchantIds.map(String)).delete();
    await db('merchant_staffs').whereIn('merchant_id', merchantIds).delete();
    await db('delivery_fees').whereIn('merchant_id', merchantIds).delete();
    await db('menu_items').whereIn('merchant_id', merchantIds).delete();
    await db('menu_categories').whereIn('merchant_id', merchantIds).delete();
    await db('merchants').whereIn('id', merchantIds).delete();
    await db.destroy();
  }
});
