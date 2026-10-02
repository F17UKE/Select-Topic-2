const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('../src/env.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createOrderService } = require('../src/order-service.cjs');
const { createPaymentService } = require('../src/payment-service.cjs');
const { createMerchantOrderService } = require('../src/merchant-order-service.cjs');
const { createRiderOrderService } = require('../src/rider-order-service.cjs');
const { createLineOrderNotifier } = require('../src/line-order-notifier.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';

function eventFromMessage(message) {
  const serialized = JSON.stringify(message);
  const match = serialized.match(/สถานะ: ([A-Z_]+)/);
  return match?.[1];
}

test('LINE notifications follow committed payment/order transitions and provider failure never rolls back', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const orderIds = [];
  let merchantId;
  let baselineCounter;
  try {
    const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
    const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first();
    const merchant = await db('merchants').where({ prefix: 'LOC' }).first();
    merchantId = merchant.id;
    baselineCounter = merchant.last_order_number;
    const manager = await db('merchant_staffs').where({ merchant_id: merchant.id, username: 'local_manager' }).first();
    const rider = await db('merchant_staffs').where({ merchant_id: merchant.id, username: 'local_rider' }).first();
    const item = await db('menu_items').where({ merchant_id: merchant.id, name: 'Local Basil Rice' }).first();
    const mild = await db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .where({ 'g.menu_item_id': item.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
    const orderService = createOrderService(db);
    async function createOrder() {
      const order = await orderService.createOrder(customer.id, {
        merchantId: merchant.id,
        addressId: address.id,
        deliveryType: 'DELIVERY',
        deliveryNote: 'LINE notification integration',
        items: [{ menuItemId: item.id, quantity: 1, optionChoiceIds: [mild.id], note: null }],
      });
      orderIds.push(order.id);
      return order;
    }
    function paymentService(notifier) {
      return createPaymentService({
        db,
        config: { verificationMode: 'mock', maxUploadBytes: 1024, retentionHours: 24 },
        storage: {
          put: async () => ({ objectKey: `test/${crypto.randomUUID()}.png`, fileHash: crypto.randomUUID().replaceAll('-', '') }),
          remove: async () => {},
        },
        verifier: {
          name: 'line-notification-fixture',
          verify: async ({ expectedAmount, expectedRecipient }) => ({
            transactionReference: `LINE-${crypto.randomUUID()}`,
            status: 'VERIFIED',
            amount: expectedAmount,
            recipient: { type: null, value: expectedRecipient },
            providerRequestId: crypto.randomUUID(),
            failureCode: null,
            rawRedacted: { fixture: true },
          }),
        },
        notifier,
      });
    }
    async function pay(service, order) {
      await service.createAttempt(customer.id, order.id);
      return service.uploadAndVerify(customer.id, order.id, {
        mimetype: 'image/png', buffer: Buffer.from('89504e470d0a1a0a5041594d454e54', 'hex'),
      }, { mockScenario: 'success' });
    }

    const pushes = [];
    const notifier = createLineOrderNotifier({
      db,
      publicAppUrl: 'https://liff.line.me/local-test',
      messaging: { push: async (to, message) => { pushes.push({ to, message }); return { sent: true }; } },
    });
    const payments = paymentService(notifier);
    const merchantOrders = createMerchantOrderService(db, { notifier });
    const riderOrders = createRiderOrderService(db, { notifier });

    await t.test('payment and full delivery flow emit each expected event once', async () => {
      const order = await createOrder();
      await pay(payments, order);
      await merchantOrders.accept(manager, order.id);
      await assert.rejects(() => merchantOrders.accept(manager, order.id));
      await merchantOrders.startPreparing(manager, order.id);
      await merchantOrders.completeAllItems(manager, order.id);
      await merchantOrders.ready(manager, order.id);
      await merchantOrders.assignRider(manager, order.id, rider.id);
      await riderOrders.startDelivery(rider, order.id);
      await riderOrders.complete(rider, order.id);
      assert.deepEqual(pushes.map(({ message }) => eventFromMessage(message)), [
        'PAYMENT_VERIFIED', 'ORDER_ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED',
      ]);
      assert.ok(pushes.every(({ to }) => to === customer.line_user_id));
      const duplicate = await notifier.notifyOrderEvent('COMPLETED', order.id);
      assert.equal(duplicate.duplicate, true);
      assert.equal(pushes.length, 6);
    });

    await t.test('rejection emits REJECTED without payment internals', async () => {
      const order = await createOrder();
      await db('orders').where({ id: order.id }).update({ payment_status: 'PAID' });
      await merchantOrders.reject(manager, order.id);
      assert.equal(eventFromMessage(pushes.at(-1).message), 'REJECTED');
      assert.ok(!JSON.stringify(pushes.at(-1).message).includes('provider_response'));
    });

    await t.test('LINE failure does not roll back merchant or payment transaction and logs no secret', async () => {
      const logs = [];
      const secret = 'SECRET_LINE_ACCESS_TOKEN_MUST_NOT_LEAK';
      const failingNotifier = createLineOrderNotifier({
        db,
        publicAppUrl: 'https://liff.line.me/local-test',
        logger: { error: (...args) => logs.push(args) },
        messaging: { push: async () => {
          const error = new Error(`provider rejected ${secret}`);
          error.code = 'line_provider_failed';
          throw error;
        } },
      });
      const paymentOrder = await createOrder();
      const failedPushPayment = await pay(paymentService(failingNotifier), paymentOrder);
      assert.equal(failedPushPayment.payment.status, 'PAID');
      assert.equal((await db('orders').where({ id: paymentOrder.id }).first('payment_status')).payment_status, 'PAID');

      const merchantOrder = await createOrder();
      await db('orders').where({ id: merchantOrder.id }).update({ payment_status: 'PAID' });
      const accepted = await createMerchantOrderService(db, { notifier: failingNotifier }).accept(manager, merchantOrder.id);
      assert.equal(accepted.order.status, 'ACCEPTED');
      assert.equal((await db('orders').where({ id: merchantOrder.id }).first('status')).status, 'ACCEPTED');
      assert.ok(logs.length >= 2);
      assert.ok(!JSON.stringify(logs).includes(secret));
    });
  } finally {
    if (orderIds.length) {
      const paymentIds = (await db('payments').whereIn('order_id', orderIds).select('id')).map((row) => row.id);
      if (paymentIds.length) {
        await db('payment_verifications').whereIn('payment_id', paymentIds).delete();
        await db('payment_slips').whereIn('payment_id', paymentIds).delete();
        await db('payments').whereIn('id', paymentIds).delete();
      }
      const itemIds = (await db('order_items').whereIn('order_id', orderIds).select('id')).map((row) => row.id);
      if (itemIds.length) await db('order_item_choices').whereIn('order_item_id', itemIds).delete();
      await db('order_items').whereIn('order_id', orderIds).delete();
      await db('orders').whereIn('id', orderIds).delete();
    }
    if (merchantId && baselineCounter !== undefined) {
      await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounter });
    }
    await db.destroy();
  }
});
