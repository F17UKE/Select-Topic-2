const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createCustomerAuth } = require('../src/auth.cjs');
const { createCustomerRepository } = require('../src/customer-repository.cjs');
const { createStoreRepository } = require('../src/store-repository.cjs');
const { createOrderService } = require('../src/order-service.cjs');
const { createPersistentIdempotencyStore } = require('../src/idempotency.cjs');
const { HttpError } = require('../src/http.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';

function appFor(db, lineUserId, orderService = createOrderService(db)) {
  return createApp({
    checkDatabase: createDatabaseProbe(db),
    auth: createCustomerAuth({
      db,
      config: { mode: 'mock', devLoginEnabled: true, devLineUserId: lineUserId, secureCookie: false },
    }),
    customers: createCustomerRepository(db),
    stores: createStoreRepository(db),
    orders: orderService,
    idempotency: createPersistentIdempotencyStore({ db }),
  });
}

async function login(app) {
  const agent = request.agent(app);
  await agent.post('/api/dev/auth/login').expect(200);
  return agent;
}

test('order creation integration: calculation, snapshots, ownership, validation, idempotency and rollback', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  let createdOrderId;
  const extraOrderIds = [];
  let secondCustomerId;
  let unsupportedAddressId;
  let unsupportedDormitoryId;
  let unsupportedSoiId;
  let merchantId;
  let baselineCounter;
  try {
    const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
    const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first();
    const merchant = await db('merchants').where({ prefix: 'LOC' }).first();
    merchantId = merchant.id;
    baselineCounter = merchant.last_order_number;
    const noodleMerchant = await db('merchants').where({ prefix: 'NDL' }).first();
    const basil = await db('menu_items').where({ merchant_id: merchant.id, name: 'Local Basil Rice' }).first();
    const garlic = await db('menu_items').where({ merchant_id: merchant.id, name: 'Garlic Chicken Rice' }).first();
    const noodle = await db('menu_items').where({ merchant_id: noodleMerchant.id, name: 'Tom Yum Noodles' }).first();
    const optionRows = await db('menu_option_choices as c')
      .join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .select('c.id', 'c.name', 'g.name as group_name', 'g.menu_item_id')
      .whereIn('g.menu_item_id', [basil.id, garlic.id, noodle.id]);
    const choice = (itemId, groupName, name) => optionRows.find((row) => (
      row.menu_item_id === itemId && row.group_name === groupName && row.name === name
    )).id;
    const mildId = choice(basil.id, 'Spiciness', 'Mild');
    const mediumId = choice(basil.id, 'Spiciness', 'Medium');
    const eggId = choice(basil.id, 'Extras', 'Fried egg');
    const riceId = choice(garlic.id, 'Rice', 'Jasmine rice');
    const noodleOptionId = choice(noodle.id, 'Spiciness', 'Mild');

    const [secondCustomer] = await db('customers').insert({
      line_user_id: 'U_ORDER_INTEGRATION_CUSTOMER_B', display_name: 'Order Test B', phone: '0800000002', is_active: true,
    }).onConflict('line_user_id').merge({ display_name: 'Order Test B', is_active: true }).returning('id');
    secondCustomerId = secondCustomer.id;
    const [secondAddress] = await db('customer_addresses').insert({
      customer_id: secondCustomerId, dormitory_id: address.dormitory_id, label: 'Order Test B',
      room_number: 'B-1', contact_phone: '0800000002', address_detail: 'Other customer', is_default: true,
    }).returning('id');

    [unsupportedSoiId] = (await db('sois').insert({ name: 'Order Integration Unsupported Soi', is_active: true })
      .onConflict('name').merge({ is_active: true }).returning('id')).map((row) => row.id);
    [unsupportedDormitoryId] = (await db('dormitories').insert({
      soi_id: unsupportedSoiId, name: 'Order Integration Unsupported Dorm', location_text: 'Unsupported test location', is_active: true,
    }).onConflict(['soi_id', 'name']).merge({ is_active: true }).returning('id')).map((row) => row.id);
    [unsupportedAddressId] = (await db('customer_addresses').insert({
      customer_id: customer.id, dormitory_id: unsupportedDormitoryId, label: 'Order Unsupported',
      room_number: 'X-1', contact_phone: '0812345678', address_detail: 'No delivery fee', is_default: false,
    }).returning('id')).map((row) => row.id);

    const app = appFor(db, 'U_LOCAL_CUSTOMER_001');
    const agent = await login(app);
    const validPayload = {
      merchantId: merchant.id,
      addressId: address.id,
      deliveryType: 'DELIVERY',
      deliveryNote: 'Meet at the lobby',
      subtotal: 1,
      deliveryFee: 1,
      total: 2,
      items: [
        { menuItemId: basil.id, quantity: 2, optionChoiceIds: [mildId, eggId], note: 'Less oil', price: 1 },
        { menuItemId: garlic.id, quantity: 1, optionChoiceIds: [riceId], note: '', price: 1 },
      ],
    };

    await t.test('creates one order using database prices, fee and complete snapshots', async () => {
      const response = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-success-1')
        .send(validPayload).expect(201);
      const order = response.body.order;
      createdOrderId = order.id;
      assert.equal(response.headers['idempotency-replayed'], 'false');
      assert.equal(order.subtotal_amount, 205);
      assert.equal(order.delivery_fee, 15);
      assert.equal(order.total_amount, 220);
      assert.equal(order.status, 'PENDING');
      assert.equal(order.payment_status, 'UNPAID');
      assert.equal(order.payment_method, 'PROMPTPAY');
      assert.equal(order.delivery_address_label, address.label);
      assert.equal(order.delivery_room_number, address.room_number);
      assert.equal(order.delivery_contact_phone, address.contact_phone);
      assert.match(order.delivery_location_text, /Leave with the lobby/);
      const basilSnapshot = order.items.find((item) => item.item_name === 'Local Basil Rice');
      assert.equal(basilSnapshot.unit_price, 60);
      assert.equal(basilSnapshot.note, 'Less oil');
      assert.deepEqual(basilSnapshot.choices.map((itemChoice) => itemChoice.choice_name).sort(), ['Fried egg', 'Mild']);
      assert.equal(basilSnapshot.choices.find((itemChoice) => itemChoice.choice_name === 'Fried egg').extra_price, 10);
    });

    await t.test('replays the same idempotency key without creating another order', async () => {
      const before = Number((await db('orders').where({ customer_id: customer.id }).count('* as count').first()).count);
      const replay = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-success-1')
        .send(validPayload).expect(201);
      const after = Number((await db('orders').where({ customer_id: customer.id }).count('* as count').first()).count);
      assert.equal(replay.headers['idempotency-replayed'], 'true');
      assert.equal(replay.body.order.id, createdOrderId);
      assert.equal(after, before);
      await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-success-1')
        .send({ ...validPayload, deliveryNote: 'Different body' }).expect(409);
    });

    await t.test('persists across app recreation and serializes concurrent duplicate order creation', async () => {
      const key = 'order-integration-restart-concurrent';
      const firstAgent = await login(appFor(db, 'U_LOCAL_CUSTOMER_001'));
      const secondAgent = await login(appFor(db, 'U_LOCAL_CUSTOMER_001'));
      const [first, second] = await Promise.all([
        firstAgent.post('/api/orders').set('Idempotency-Key', key).send(validPayload),
        secondAgent.post('/api/orders').set('Idempotency-Key', key).send(validPayload),
      ]);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.equal(first.body.order.id, second.body.order.id);
      assert.deepEqual([first.headers['idempotency-replayed'], second.headers['idempotency-replayed']].sort(), ['false', 'true']);
      extraOrderIds.push(first.body.order.id);
      const afterRestart = await (await login(appFor(db, 'U_LOCAL_CUSTOMER_001')))
        .post('/api/orders').set('Idempotency-Key', key).send(validPayload).expect(201);
      assert.equal(afterRestart.body.order.id, first.body.order.id);
      assert.equal(afterRestart.headers['idempotency-replayed'], 'true');
    });

    await t.test('lists and reads only snapshot-based orders owned by the customer', async () => {
      const list = await agent.get('/api/orders').expect(200);
      assert.ok(list.body.orders.some((order) => order.id === createdOrderId && order.total_amount === 220));
      const detail = await agent.get(`/api/orders/${createdOrderId}`).expect(200);
      assert.equal(detail.body.order.items[0].item_name, 'Local Basil Rice');
      const otherAgent = await login(appFor(db, 'U_ORDER_INTEGRATION_CUSTOMER_B'));
      await otherAgent.get(`/api/orders/${createdOrderId}`).expect(404, { error: 'order_not_found', message: 'order_not_found' });
    });

    await t.test('rejects another customer address and unsupported delivery soi', async () => {
      await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-address-b')
        .send({ ...validPayload, addressId: secondAddress.id }).expect(404);
      const unsupported = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-no-fee')
        .send({ ...validPayload, addressId: unsupportedAddressId }).expect(422);
      assert.equal(unsupported.body.error, 'unsupported_delivery_location');
    });

    await t.test('rejects cross-merchant, invalid, missing and excessive options', async () => {
      const crossMerchant = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-cross-merchant')
        .send({ ...validPayload, items: [{ menuItemId: noodle.id, quantity: 1, optionChoiceIds: [] }] }).expect(400);
      assert.equal(crossMerchant.body.error, 'cross_merchant_item');
      const invalidChoice = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-invalid-option')
        .send({ ...validPayload, items: [{ menuItemId: basil.id, quantity: 1, optionChoiceIds: [mildId, noodleOptionId] }] }).expect(400);
      assert.equal(invalidChoice.body.error, 'invalid_option_choice');
      const missing = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-missing-option')
        .send({ ...validPayload, items: [{ menuItemId: basil.id, quantity: 1, optionChoiceIds: [] }] }).expect(422);
      assert.equal(missing.body.error, 'option_min_choices');
      const excessive = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-max-option')
        .send({ ...validPayload, items: [{ menuItemId: basil.id, quantity: 1, optionChoiceIds: [mildId, mediumId] }] }).expect(422);
      assert.equal(excessive.body.error, 'option_max_choices');
    });

    await t.test('rejects unavailable menu and non-positive quantity', async () => {
      await db('menu_items').where({ id: garlic.id }).update({ is_available: false });
      try {
        const unavailable = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-unavailable')
          .send({ ...validPayload, items: [{ menuItemId: garlic.id, quantity: 1, optionChoiceIds: [riceId] }] }).expect(409);
        assert.equal(unavailable.body.error, 'menu_item_unavailable');
      } finally {
        await db('menu_items').where({ id: garlic.id }).update({ is_available: true });
      }
      const combinedStock = await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-combined-stock')
        .send({ ...validPayload, items: [
          { menuItemId: garlic.id, quantity: 10, optionChoiceIds: [riceId] },
          { menuItemId: garlic.id, quantity: 10, optionChoiceIds: [riceId] },
        ] }).expect(409);
      assert.equal(combinedStock.body.error, 'menu_item_unavailable');
      await agent.post('/api/orders').set('Idempotency-Key', 'order-integration-zero-qty')
        .send({ ...validPayload, items: [{ menuItemId: basil.id, quantity: 0, optionChoiceIds: [mildId] }] }).expect(400);
    });

    await t.test('rolls back the order and merchant counter when a transaction fails', async () => {
      const countBefore = Number((await db('orders').count('* as count').first()).count);
      const counterBefore = (await db('merchants').where({ id: merchant.id }).first('last_order_number')).last_order_number;
      const rollbackService = createOrderService(db, {
        beforeCommit: async () => { throw new HttpError(500, 'synthetic_rollback'); },
      });
      const rollbackAgent = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', rollbackService));
      const result = await rollbackAgent.post('/api/orders').set('Idempotency-Key', 'order-integration-rollback')
        .send(validPayload).expect(500);
      assert.equal(result.body.error, 'synthetic_rollback');
      assert.equal(Number((await db('orders').count('* as count').first()).count), countBefore);
      assert.equal((await db('merchants').where({ id: merchant.id }).first('last_order_number')).last_order_number, counterBefore);
    });
  } finally {
    const cleanupOrderIds = [createdOrderId, ...extraOrderIds].filter(Boolean);
    if (cleanupOrderIds.length) {
      const itemIds = (await db('order_items').whereIn('order_id', cleanupOrderIds).select('id')).map((row) => row.id);
      if (itemIds.length) await db('order_item_choices').whereIn('order_item_id', itemIds).delete();
      await db('order_items').whereIn('order_id', cleanupOrderIds).delete();
      await db('orders').whereIn('id', cleanupOrderIds).delete();
    }
    if (merchantId !== undefined && baselineCounter !== undefined) {
      await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounter });
    }
    if (unsupportedAddressId) await db('customer_addresses').where({ id: unsupportedAddressId }).delete();
    if (unsupportedDormitoryId) await db('dormitories').where({ id: unsupportedDormitoryId }).delete();
    if (unsupportedSoiId) await db('sois').where({ id: unsupportedSoiId }).delete();
    if (secondCustomerId) {
      await db('customer_addresses').where({ customer_id: secondCustomerId }).delete();
      await db('customers').where({ id: secondCustomerId }).delete();
    }
    await db('idempotency_keys').where('scope', 'like', 'customer:%:orders').delete();
    await db.destroy();
  }
});
