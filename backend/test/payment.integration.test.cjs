const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const generatePromptPayPayload = require('promptpay-qr');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createCustomerAuth } = require('../src/auth.cjs');
const { createCustomerRepository } = require('../src/customer-repository.cjs');
const { createStoreRepository } = require('../src/store-repository.cjs');
const { createOrderService } = require('../src/order-service.cjs');
const { createIdempotencyStore } = require('../src/idempotency.cjs');
const { createLocalSlipStorage } = require('../src/slip-storage.cjs');
const { createPaymentVerifier } = require('../src/payment-verifier.cjs');
const { createPaymentService } = require('../src/payment-service.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';
const png = (label) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]);

function appFor(db, lineUserId, storageRoot) {
  const config = { verificationMode: 'mock', storageRoot, maxUploadBytes: 1024, retentionHours: 24 };
  return createApp({
    checkDatabase: createDatabaseProbe(db),
    auth: createCustomerAuth({
      db,
      config: { mode: 'mock', devLoginEnabled: true, devLineUserId: lineUserId, secureCookie: false },
    }),
    customers: createCustomerRepository(db),
    stores: createStoreRepository(db),
    orders: createOrderService(db),
    idempotency: createIdempotencyStore(),
    payments: createPaymentService({
      db,
      config,
      storage: createLocalSlipStorage({ rootDir: storageRoot }),
      verifier: createPaymentVerifier(config),
    }),
  });
}

async function login(app) {
  const agent = request.agent(app);
  await agent.post('/api/dev/auth/login').expect(200);
  return agent;
}

test('PromptPay payment pipeline: ownership, QR, upload validation, verification and duplicate safety', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'select-topic-2-slips-'));
  const orderIds = [];
  let secondCustomerId;
  let merchantId;
  let baselineCounter;
  try {
    const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
    const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first();
    const merchant = await db('merchants').where({ prefix: 'LOC' }).first();
    merchantId = merchant.id;
    baselineCounter = merchant.last_order_number;
    const item = await db('menu_items').where({ merchant_id: merchant.id, name: 'Local Basil Rice' }).first();
    const mild = await db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .where({ 'g.menu_item_id': item.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
    const payload = {
      merchantId: merchant.id,
      addressId: address.id,
      deliveryType: 'DELIVERY',
      deliveryNote: null,
      items: [{ menuItemId: item.id, quantity: 1, optionChoiceIds: [mild.id], note: null }],
    };
    const [secondCustomer] = await db('customers').insert({
      line_user_id: 'U_PAYMENT_INTEGRATION_CUSTOMER_B', display_name: 'Payment Test B', phone: '0800000012', is_active: true,
    }).onConflict('line_user_id').merge({ display_name: 'Payment Test B', is_active: true }).returning('id');
    secondCustomerId = secondCustomer.id;

    const app = appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot);
    const agent = await login(app);
    const otherAgent = await login(appFor(db, 'U_PAYMENT_INTEGRATION_CUSTOMER_B', storageRoot));
    async function createOrder() {
      const response = await agent.post('/api/orders')
        .set('Idempotency-Key', `payment-${crypto.randomUUID()}`).send(payload).expect(201);
      orderIds.push(response.body.order.id);
      return response.body.order;
    }
    async function attempt(orderId, body = {}) {
      return (await agent.post(`/api/orders/${orderId}/payments`).send(body).expect(201)).body.payment;
    }
    async function upload(orderId, label, fields = {}, expected = 200) {
      let call = agent.post(`/api/orders/${orderId}/payment/slip`);
      for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
      return call.attach('slip', png(label), { filename: `${label}.png`, contentType: 'image/png' }).expect(expected);
    }

    await t.test('creates an attempt from the server total and generates the merchant QR', async () => {
      const order = await createOrder();
      const payment = await attempt(order.id, { expectedAmount: 0.01, promptpayId: '0999999999' });
      assert.equal(payment.status, 'PENDING');
      assert.equal(payment.verification_status, 'PENDING');
      assert.equal(payment.expected_amount, order.total_amount);
      const qr = (await agent.get(`/api/orders/${order.id}/payment/qr`).expect(200)).body.qr;
      assert.equal(qr.amount, order.total_amount);
      assert.equal(qr.payload, generatePromptPayPayload(merchant.promptpay_id, { amount: order.total_amount }));
      assert.match(qr.image_data_url, /^data:image\/png;base64,/);
      assert.ok(!JSON.stringify(qr).includes(merchant.promptpay_id));
      const same = await attempt(order.id);
      assert.equal(same.id, payment.id, 'active attempt is reused');
    });

    await t.test('verifies a valid slip and changes only payment status on the order', async () => {
      const order = await createOrder();
      await attempt(order.id);
      const response = await upload(order.id, 'success', {
        mockScenario: 'success', mockTransactionReference: `TX-SUCCESS-${order.id}`,
      });
      assert.equal(response.body.payment.status, 'PAID');
      assert.equal(response.body.payment.verification_status, 'VERIFIED');
      assert.equal(response.body.payment.amount_transferred, order.total_amount);
      assert.equal(response.body.payment.slip.object_key.startsWith('slips/'), true);
      assert.equal(path.isAbsolute(response.body.payment.slip.object_key), false);
      const saved = await db('orders').where({ id: order.id }).first('status', 'payment_status');
      assert.deepEqual(saved, { status: 'PENDING', payment_status: 'PAID' });
      const verification = response.body.payment.verification;
      assert.equal(verification.status, 'VERIFIED');
      assert.equal(JSON.stringify(verification.provider_response).includes(merchant.promptpay_id), false);
      await upload(order.id, 'repeat', { mockScenario: 'success' }, 409);
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as count').first()).count), 1);
    });

    await t.test('rejects unauthorized, unsupported, forged and oversized uploads', async () => {
      const order = await createOrder();
      await attempt(order.id);
      await otherAgent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', png('other'), { filename: 'other.png', contentType: 'image/png' }).expect(404);
      await agent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', Buffer.from('plain text'), { filename: 'fake.png', contentType: 'text/plain' }).expect(415);
      await agent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', Buffer.from('not a png'), { filename: 'fake.png', contentType: 'image/png' }).expect(415);
      await agent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', Buffer.alloc(2048, 1), { filename: 'large.png', contentType: 'image/png' }).expect(413);
      const payment = await db('payments').where({ order_id: order.id }).first();
      assert.equal(payment.status, 'PENDING');
    });

    for (const [scenario, failureCode, verificationStatus] of [
      ['amount_mismatch', 'AMOUNT_MISMATCH', 'REJECTED'],
      ['recipient_mismatch', 'RECIPIENT_MISMATCH', 'REJECTED'],
      ['provider_error', 'mock_provider_error', 'ERROR'],
    ]) {
      await t.test(`${scenario} never marks an order paid and allows a new attempt`, async () => {
        const order = await createOrder();
        const first = await attempt(order.id);
        const response = await upload(order.id, scenario, { mockScenario: scenario });
        assert.equal(response.body.payment.status, 'FAILED');
        assert.equal(response.body.payment.verification_status, verificationStatus);
        assert.equal(response.body.payment.verification.failure_code, failureCode);
        const saved = await db('orders').where({ id: order.id }).first('status', 'payment_status');
        assert.equal(saved.status, 'PENDING');
        assert.equal(saved.payment_status, 'FAILED');
        const retry = await attempt(order.id);
        assert.notEqual(retry.id, first.id);
        assert.equal(retry.status, 'PENDING');
      });
    }

    await t.test('rejects a transaction reference already paid on another order', async () => {
      const reference = `TX-DUPLICATE-${crypto.randomUUID()}`;
      const firstOrder = await createOrder();
      await attempt(firstOrder.id);
      await upload(firstOrder.id, 'duplicate-a', { mockScenario: 'success', mockTransactionReference: reference });
      const secondOrder = await createOrder();
      await attempt(secondOrder.id);
      const duplicate = await upload(secondOrder.id, 'duplicate-b', { mockScenario: 'success', mockTransactionReference: reference });
      assert.equal(duplicate.body.payment.status, 'FAILED');
      assert.equal(duplicate.body.payment.verification.failure_code, 'DUPLICATE_TRANSACTION_REFERENCE');
      assert.equal((await db('orders').where({ id: secondOrder.id }).first('payment_status')).payment_status, 'FAILED');
    });

    await t.test('concurrent uploads produce exactly one paid payment', async () => {
      const order = await createOrder();
      await attempt(order.id);
      const calls = ['race-a', 'race-b'].map((label) => agent.post(`/api/orders/${order.id}/payment/slip`)
        .field('mockScenario', 'success')
        .field('mockTransactionReference', `TX-${label}-${order.id}`)
        .attach('slip', png(label), { filename: `${label}.png`, contentType: 'image/png' }));
      const results = await Promise.all(calls);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as count').first()).count), 1);
      assert.equal((await db('orders').where({ id: order.id }).first('status')).status, 'PENDING');
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
    if (secondCustomerId) await db('customers').where({ id: secondCustomerId }).delete();
    await db.destroy();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
