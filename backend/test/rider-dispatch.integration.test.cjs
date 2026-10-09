const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createMerchantStaffAuth } = require('../src/staff-auth.cjs');
const { createMerchantOrderService } = require('../src/merchant-order-service.cjs');
const { createRiderOrderService } = require('../src/rider-order-service.cjs');
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
    riderOrders: createRiderOrderService(db),
  });
}

async function login(db, username) {
  const agent = request.agent(appFor(db, username));
  await agent.post('/api/dev/merchant/auth/login').send({ username }).expect(200);
  return agent;
}

test('rider dispatch permissions, isolation, locking and delivery state machine', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const createdOrderIds = [];
  const createdStaffIds = [];
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
    const localMerchant = merchants.find((row) => row.prefix === 'LOC');
    const foreignMerchant = merchants.find((row) => row.prefix === 'NDL');
    const menuItem = await db('menu_items').where({ merchant_id: localMerchant.id, name: 'Local Basil Rice' }).first();
    const mild = await db('menu_option_choices as c')
      .join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .where({ 'g.menu_item_id': menuItem.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
    const orderService = createOrderService(db);

    async function addStaff(merchantId, username, { active = true } = {}) {
      const [staff] = await db('merchant_staffs').insert({
        merchant_id: merchantId,
        username,
        password_hash: 'integration-test-only',
        full_name: `Integration ${username}`,
        phone: '0890000000',
        role: 'RIDER',
        is_active: active,
      }).returning('*');
      createdStaffIds.push(staff.id);
      return staff;
    }

    const secondRider = await addStaff(localMerchant.id, 'integration_rider_2');
    const inactiveRider = await addStaff(localMerchant.id, 'integration_rider_inactive', { active: false });
    const foreignRider = await addStaff(foreignMerchant.id, 'integration_rider_foreign');
    const seededRider = await db('merchant_staffs').where({ username: 'local_rider' }).first();

    async function createReadyOrder() {
      const order = await orderService.createOrder(customer.id, {
        merchantId: localMerchant.id,
        addressId: address.id,
        deliveryType: 'DELIVERY',
        deliveryNote: 'Call from rider integration test',
        items: [{ menuItemId: menuItem.id, quantity: 1, optionChoiceIds: [mild.id], note: 'No cutlery' }],
      });
      createdOrderIds.push(order.id);
      await db('orders').where({ id: order.id }).update({ payment_status: 'PAID' });
      await manager.post(`/api/merchant/orders/${order.id}/accept`).expect(200);
      await manager.post(`/api/merchant/orders/${order.id}/start-preparing`).expect(200);
      await manager.post(`/api/merchant/orders/${order.id}/complete-all-items`).expect(200);
      await manager.post(`/api/merchant/orders/${order.id}/ready`).expect(200);
      return order;
    }

    const manager = await login(db, 'local_manager');
    const cashier = await login(db, 'local_cashier');
    const kitchen = await login(db, 'local_kitchen');
    const rider = await login(db, 'local_rider');
    const riderTwo = await login(db, secondRider.username);
    const foreignRiderAgent = await login(db, foreignRider.username);

    await t.test('manager lists only active riders from its own merchant', async () => {
      const response = await manager.get('/api/merchant/riders').expect(200);
      const riderIds = response.body.riders.map((row) => row.id);
      assert.ok(riderIds.includes(seededRider.id));
      assert.ok(riderIds.includes(secondRider.id));
      assert.ok(!riderIds.includes(inactiveRider.id));
      assert.ok(!riderIds.includes(foreignRider.id));
      await cashier.get('/api/merchant/riders').expect(403);
      await kitchen.get('/api/merchant/riders').expect(403);
      await rider.get('/api/merchant/riders').expect(403);
    });

    await t.test('portal boundaries reject forged roles and tenant parameters without internal permission text', async () => {
      const order = await createReadyOrder();
      const denied = await rider.get('/api/merchant/orders?role=MANAGER&merchant_id=1')
        .set('X-Staff-Role', 'MANAGER').expect(403);
      assert.doesNotMatch(denied.body.message, /cannot perform|VIEW|ASSIGN_RIDER/);
      for (const agent of [manager, cashier, kitchen]) {
        await agent.get('/api/rider/orders').expect(403);
        await agent.post(`/api/rider/orders/${order.id}/start-delivery`).send({ role: 'RIDER', staffId: seededRider.id }).expect(403);
      }
      await rider.post(`/api/merchant/orders/${order.id}/assign-rider`)
        .send({ role: 'MANAGER', merchant_id: localMerchant.id, riderId: seededRider.id }).expect(403);
      const forged = request(appFor(db, 'local_rider'));
      await forged.get('/api/rider/orders').set('Cookie', 'merchant_staff_session=forged; role=MANAGER').expect(401);
    });

    await t.test('inactive or changed-role rider loses authority on the next request, despite existing session', async () => {
      const temporary = await addStaff(localMerchant.id, 'integration_rider_session');
      const agent = await login(db, temporary.username);
      const order = await createReadyOrder();
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: temporary.id }).expect(200);
      await db('merchant_staffs').where({ id: temporary.id }).update({ role: 'KITCHEN' });
      await agent.post(`/api/rider/orders/${order.id}/start-delivery`).send({ role: 'RIDER' }).expect(403);
      await db('merchant_staffs').where({ id: temporary.id }).update({ role: 'RIDER', is_active: false });
      await agent.post(`/api/rider/orders/${order.id}/start-delivery`).expect(401);
      assert.equal((await db('orders').where({ id: order.id }).first()).status, 'READY');
    });

    await t.test('only manager assigns an active rider from the order merchant', async () => {
      const order = await createReadyOrder();
      for (const agent of [cashier, kitchen, rider]) {
        await agent.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: seededRider.id }).expect(403);
      }
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: foreignRider.id }).expect(404);
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: inactiveRider.id }).expect(404);
      const assigned = await manager.post(`/api/merchant/orders/${order.id}/assign-rider`)
        .send({ riderId: seededRider.id }).expect(200);
      assert.equal(assigned.body.order.assigned_rider.id, seededRider.id);
    });

    await t.test('row lock prevents two manager sessions from silently overwriting an assignment', async () => {
      const order = await createReadyOrder();
      const managerTwo = await login(db, 'local_manager');
      const results = await Promise.all([
        manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: seededRider.id }),
        managerTwo.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: secondRider.id }),
      ]);
      assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
      const stored = await db('orders').where({ id: order.id }).first('assigned_rider_id');
      assert.ok([seededRider.id, secondRider.id].includes(stored.assigned_rider_id));
    });

    await t.test('rider sees only assigned orders and response excludes payment internals', async () => {
      const assignedOrder = await createReadyOrder();
      const otherOrder = await createReadyOrder();
      await manager.post(`/api/merchant/orders/${assignedOrder.id}/assign-rider`).send({ riderId: seededRider.id }).expect(200);
      await manager.post(`/api/merchant/orders/${otherOrder.id}/assign-rider`).send({ riderId: secondRider.id }).expect(200);
      const list = await rider.get('/api/rider/orders').expect(200);
      assert.ok(list.body.orders.some((order) => order.id === assignedOrder.id));
      assert.ok(!list.body.orders.some((order) => order.id === otherOrder.id));
      const detail = await rider.get(`/api/rider/orders/${assignedOrder.id}`).expect(200);
      assert.equal(detail.body.order.customer_name, customer.display_name);
      assert.equal(detail.body.order.items[0].item_name, 'Local Basil Rice');
      assert.equal(detail.body.order.payment_status, undefined);
      assert.equal(detail.body.order.total_amount, undefined);
      assert.equal(detail.body.order.provider_response, undefined);
      await riderTwo.get(`/api/rider/orders/${assignedOrder.id}`).expect(404);
      await foreignRiderAgent.get(`/api/rider/orders/${assignedOrder.id}`).expect(404);
    });

    await t.test('unassignment is safe before delivery and invalidates the old rider', async () => {
      const order = await createReadyOrder();
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: seededRider.id }).expect(200);
      await manager.post(`/api/merchant/orders/${order.id}/unassign-rider`).expect(200);
      await rider.get(`/api/rider/orders/${order.id}`).expect(404);
      await rider.post(`/api/rider/orders/${order.id}/start-delivery`).expect(404);
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: secondRider.id }).expect(200);
      await rider.post(`/api/rider/orders/${order.id}/start-delivery`).expect(404);
    });

    await t.test('READY -> DELIVERING -> COMPLETED is assigned-rider only and terminal', async () => {
      const order = await createReadyOrder();
      await rider.post(`/api/rider/orders/${order.id}/start-delivery`).expect(404);
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: seededRider.id }).expect(200);
      await rider.post(`/api/rider/orders/${order.id}/complete`).expect(409);
      await riderTwo.post(`/api/rider/orders/${order.id}/start-delivery`).expect(404);
      const delivering = await rider.post(`/api/rider/orders/${order.id}/start-delivery`).expect(200);
      assert.equal(delivering.body.order.status, 'DELIVERING');
      await manager.post(`/api/merchant/orders/${order.id}/unassign-rider`).expect(409);
      await manager.post(`/api/merchant/orders/${order.id}/assign-rider`).send({ riderId: secondRider.id }).expect(409);
      await rider.post(`/api/rider/orders/${order.id}/start-delivery`).expect(409);
      const completed = await rider.post(`/api/rider/orders/${order.id}/complete`).expect(200);
      assert.equal(completed.body.order.status, 'COMPLETED');
      assert.ok(completed.body.order.completed_at);
      await rider.post(`/api/rider/orders/${order.id}/complete`).expect(409);
      await rider.post(`/api/rider/orders/${order.id}/start-delivery`).expect(409);
      await manager.post(`/api/merchant/orders/${order.id}/unassign-rider`).expect(409);
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
    if (createdStaffIds.length) await db('merchant_staffs').whereIn('id', createdStaffIds).delete();
    for (const merchantId of merchantIds) {
      await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounters.get(merchantId) });
    }
    await db.destroy();
  }
});
