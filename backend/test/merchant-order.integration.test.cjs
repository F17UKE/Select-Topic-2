const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createMerchantStaffAuth } = require('../src/staff-auth.cjs');
const { createMerchantOrderService } = require('../src/merchant-order-service.cjs');
const { createOrderService } = require('../src/order-service.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';

function appFor(db, username) {
  return createApp({
    checkDatabase: createDatabaseProbe(db),
    staffAuth: createMerchantStaffAuth({
      db,
      config: { mode: 'mock', devLoginEnabled: true, defaultUsername: username, secureCookie: false },
    }),
    merchantOrders: createMerchantOrderService(db),
  });
}

async function login(db, username) {
  const agent = request.agent(appFor(db, username));
  const response = await agent.post('/api/dev/merchant/auth/login').send({ username }).expect(200);
  assert.equal(response.body.staff.username, username);
  return agent;
}

test('merchant dashboard state machine, tenant isolation, role permissions and KDS', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const createdOrderIds = [];
  const merchantIds = [];
  const baselineCounters = new Map();
  try {
    const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
    const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first();
    const merchants = await db('merchants').whereIn('prefix', ['LOC', 'NDL']).select('*');
    for (const merchant of merchants) {
      merchantIds.push(merchant.id);
      baselineCounters.set(merchant.id, merchant.last_order_number);
    }
    const merchant = (prefix) => merchants.find((row) => row.prefix === prefix);
    const orderService = createOrderService(db);

    async function choiceFor(itemId, groupName, name) {
      return db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id')
        .where({ 'g.menu_item_id': itemId, 'g.name': groupName, 'c.name': name }).first('c.id');
    }
    const basil = await db('menu_items').where({ merchant_id: merchant('LOC').id, name: 'Local Basil Rice' }).first();
    const mild = await choiceFor(basil.id, 'Spiciness', 'Mild');
    const noodle = await db('menu_items').where({ merchant_id: merchant('NDL').id, name: 'Tom Yum Noodles' }).first();
    const noodleMild = await choiceFor(noodle.id, 'Spiciness', 'Mild');
    const riceNoodles = await choiceFor(noodle.id, 'Noodle type', 'Rice noodles');

    async function createOrder(prefix = 'LOC') {
      const selectedMerchant = merchant(prefix);
      const selectedItem = prefix === 'LOC' ? basil : noodle;
      const choices = prefix === 'LOC' ? [mild.id] : [noodleMild.id, riceNoodles.id];
      const order = await orderService.createOrder(customer.id, {
        merchantId: selectedMerchant.id,
        addressId: address.id,
        deliveryType: 'DELIVERY',
        deliveryNote: 'Merchant dashboard integration note',
        items: [{ menuItemId: selectedItem.id, quantity: 1, optionChoiceIds: choices, note: 'Kitchen note' }],
      });
      createdOrderIds.push(order.id);
      return order;
    }
    async function markPaid(order) {
      const reference = `MERCHANT-${order.id}-${crypto.randomUUID()}`;
      await db.transaction(async (trx) => {
        await trx('orders').where({ id: order.id }).update({ payment_status: 'PAID' });
        await trx('payments').insert({
          order_id: order.id, method: 'PROMPTPAY', status: 'PAID', verification_status: 'VERIFIED',
          expected_amount: order.total_amount, amount_transferred: order.total_amount,
          provider: 'integration-fixture', transaction_reference: reference,
          verified_at: trx.fn.now(), paid_at: trx.fn.now(),
        });
      });
    }

    const manager = await login(db, 'local_manager');
    const cashier = await login(db, 'local_cashier');
    const kitchen = await login(db, 'local_kitchen');

    await t.test('staff sees only its merchant orders and kitchen response is least-privilege', async () => {
      const own = await createOrder('LOC');
      const foreign = await createOrder('NDL');
      const list = await manager.get('/api/merchant/orders').expect(200);
      assert.ok(list.body.orders.some((order) => order.id === own.id));
      assert.ok(!list.body.orders.some((order) => order.id === foreign.id));
      await manager.get(`/api/merchant/orders/${foreign.id}`).expect(404);
      for (const agent of [cashier, kitchen]) {
        const scoped = await agent.get('/api/merchant/orders').expect(200);
        assert.ok(!scoped.body.orders.some((order) => order.id === foreign.id));
        await agent.get(`/api/merchant/orders/${foreign.id}`).expect(404);
        await agent.post(`/api/merchant/orders/${foreign.id}/start-preparing`).expect(agent === cashier ? 404 : 403);
      }
      const kitchenList = await kitchen.get('/api/merchant/orders').expect(200);
      const kitchenOrder = kitchenList.body.orders.find((order) => order.id === own.id);
      assert.ok(kitchenOrder);
      assert.equal(kitchenOrder.customer, undefined);
      assert.equal(kitchenOrder.total_amount, undefined);
      assert.equal(kitchenOrder.delivery, undefined);
      assert.equal(kitchenOrder.delivery_note, undefined);
      assert.equal(kitchenOrder.items[0].item_name, 'Local Basil Rice');
      assert.equal(kitchenOrder.items[0].choices[0].choice_name, 'Mild');
    });

    await t.test('unpaid PromptPay order cannot be accepted and state cannot be skipped', async () => {
      const order = await createOrder();
      const unpaid = await manager.post(`/api/merchant/orders/${order.id}/accept`).expect(409);
      assert.equal(unpaid.body.error, 'payment_required');
      const skip = await cashier.post(`/api/merchant/orders/${order.id}/start-preparing`).expect(409);
      assert.equal(skip.body.error, 'invalid_order_transition');
      assert.equal((await db('orders').where({ id: order.id }).first('status')).status, 'PENDING');
    });

    await t.test('paid order follows PENDING -> ACCEPTED -> PREPARING -> READY manually', async () => {
      const order = await createOrder();
      await markPaid(order);
      await kitchen.post(`/api/merchant/orders/${order.id}/accept`).expect(403);
      await manager.post(`/api/merchant/orders/${order.id}/accept`).expect(200);
      await manager.post(`/api/merchant/orders/${order.id}/accept`).expect(409);
      await kitchen.post(`/api/merchant/orders/${order.id}/start-preparing`).expect(403);
      const preparing = await cashier.post(`/api/merchant/orders/${order.id}/start-preparing`).expect(200);
      assert.equal(preparing.body.order.status, 'PREPARING');
      await cashier.patch(`/api/merchant/orders/${order.id}/items/${preparing.body.order.items[0].id}`)
        .send({ completed: true }).expect(403);
      const incomplete = await kitchen.post(`/api/merchant/orders/${order.id}/ready`).expect(409);
      assert.equal(incomplete.body.error, 'items_incomplete');
      const itemId = preparing.body.order.items[0].id;
      let updated = await kitchen.patch(`/api/merchant/orders/${order.id}/items/${itemId}`)
        .send({ completed: true }).expect(200);
      assert.equal(updated.body.order.items[0].is_completed, true);
      updated = await manager.patch(`/api/merchant/orders/${order.id}/items/${itemId}`)
        .send({ completed: false }).expect(200);
      assert.equal(updated.body.order.items[0].is_completed, false);
      await kitchen.post(`/api/merchant/orders/${order.id}/complete-all-items`).expect(200);
      await cashier.post(`/api/merchant/orders/${order.id}/ready`).expect(403);
      const ready = await kitchen.post(`/api/merchant/orders/${order.id}/ready`).expect(200);
      assert.equal(ready.body.order.status, 'READY');
      assert.equal(ready.body.order.payment_status, 'PAID');
      await manager.post(`/api/merchant/orders/${order.id}/start-preparing`).expect(409);
      await kitchen.patch(`/api/merchant/orders/${order.id}/items/${itemId}`).send({ completed: false }).expect(409);
    });

    await t.test('reject works only from PENDING and a paid rejection flags manual refund', async () => {
      const order = await createOrder();
      await markPaid(order);
      await manager.post(`/api/merchant/orders/${order.id}/reject`).send({ reason: 'Cannot fulfill' }).expect(422, {
        error: 'reject_reason_not_supported', message: 'Schema V3 has no reject_reason column',
      });
      const rejected = await cashier.post(`/api/merchant/orders/${order.id}/reject`).expect(200);
      assert.equal(rejected.body.order.status, 'REJECTED');
      assert.equal(rejected.body.order.payment_status, 'PAID');
      assert.equal(rejected.body.refund_required, true);
      assert.equal(rejected.body.order.refund_required, true);
      await manager.post(`/api/merchant/orders/${order.id}/accept`).expect(409);
      await manager.post(`/api/merchant/orders/${order.id}/reject`).expect(409);
      assert.equal((await db('payments').where({ order_id: order.id }).first('status')).status, 'PAID');
    });

    await t.test('RIDER can authenticate locally but merchant order APIs stay out of scope', async () => {
      const rider = await login(db, 'local_rider');
      await rider.get('/api/merchant/orders').expect(403);
    });
  } finally {
    if (createdOrderIds.length) {
      const paymentIds = (await db('payments').whereIn('order_id', createdOrderIds).select('id')).map((row) => row.id);
      if (paymentIds.length) {
        await db('payment_verifications').whereIn('payment_id', paymentIds).delete();
        await db('payment_slips').whereIn('payment_id', paymentIds).delete();
        await db('payments').whereIn('id', paymentIds).delete();
      }
      const itemIds = (await db('order_items').whereIn('order_id', createdOrderIds).select('id')).map((row) => row.id);
      if (itemIds.length) await db('order_item_choices').whereIn('order_item_id', itemIds).delete();
      await db('order_items').whereIn('order_id', createdOrderIds).delete();
      await db('orders').whereIn('id', createdOrderIds).delete();
    }
    for (const merchantId of merchantIds) {
      await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounters.get(merchantId) });
    }
    await db.destroy();
  }
});
