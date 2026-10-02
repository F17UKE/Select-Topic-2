const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createMerchantStaffAuth } = require('../src/staff-auth.cjs');
const { createLineWebhook, signatureFor } = require('../src/line-webhook.cjs');
const { createNotificationOutbox } = require('../src/notification-outbox.cjs');
const { createOrderService } = require('../src/order-service.cjs');
const { createObjectSlipStorage } = require('../src/slip-storage.cjs');
const { createSlipRetention } = require('../src/slip-retention.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';

async function orderFixture(db) {
  const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first();
  const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first();
  const merchant = await db('merchants').where({ prefix: 'LOC' }).first();
  const item = await db('menu_items').where({ merchant_id: merchant.id, name: 'Local Basil Rice' }).first();
  const choice = await db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id')
    .where({ 'g.menu_item_id': item.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
  const order = await createOrderService(db).createOrder(customer.id, {
    merchantId: merchant.id, addressId: address.id, deliveryType: 'DELIVERY', deliveryNote: null,
    items: [{ menuItemId: item.id, quantity: 1, optionChoiceIds: [choice.id], note: null }],
  });
  return { order, merchant, customer };
}

async function cleanupOrder(db, orderId, merchantId, baselineCounter) {
  const paymentIds = await db('payments').where({ order_id: orderId }).pluck('id');
  if (paymentIds.length) {
    await db('payment_verifications').whereIn('payment_id', paymentIds).delete();
    await db('payment_slips').whereIn('payment_id', paymentIds).delete();
    await db('payments').whereIn('id', paymentIds).delete();
  }
  const itemIds = await db('order_items').where({ order_id: orderId }).pluck('id');
  if (itemIds.length) await db('order_item_choices').whereIn('order_item_id', itemIds).delete();
  await db('order_items').where({ order_id: orderId }).delete();
  await db('notification_outbox').where({ order_id: orderId }).delete();
  await db('orders').where({ id: orderId }).delete();
  await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounter });
}

test('production hardening: staff password auth, durable webhook/outbox and slip retention', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  let fixture;
  try {
    await t.test('password login verifies bcrypt, regenerates session and invalidates logout', async () => {
      const auth = createMerchantStaffAuth({
        db, config: { mode: 'password', devLoginEnabled: false, secureCookie: true },
      });
      const app = createApp({ checkDatabase: async () => ({ status: 'ok' }), staffAuth: auth, merchantOrders: {} });
      await request(app).post('/api/merchant/auth/login')
        .send({ username: 'local_manager', password: 'wrong-password' }).expect(401);
      const first = await request(app).post('/api/merchant/auth/login')
        .send({ username: 'local_manager', password: 'local-development-only' }).expect(200);
      const firstCookie = first.headers['set-cookie'][0];
      assert.match(firstCookie, /HttpOnly/);
      assert.match(firstCookie, /SameSite=Lax/);
      assert.match(firstCookie, /Secure/);
      assert.equal(JSON.stringify(first.body).includes('password_hash'), false);
      const second = await request(app).post('/api/merchant/auth/login').set('Cookie', firstCookie)
        .send({ username: 'local_manager', password: 'local-development-only' }).expect(200);
      const secondCookie = second.headers['set-cookie'][0];
      assert.notEqual(firstCookie, secondCookie);
      await request(app).get('/api/merchant/auth/me').set('Cookie', firstCookie).expect(401);
      await request(app).get('/api/merchant/auth/me').set('Cookie', secondCookie).expect(200);
      await request(app).post('/api/merchant/auth/logout').set('Cookie', secondCookie).expect(204);
      await request(app).get('/api/merchant/auth/me').set('Cookie', secondCookie).expect(401);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app).post('/api/merchant/auth/login')
          .send({ username: 'local_cashier', password: 'wrong-password' }).expect(401);
      }
      await request(app).post('/api/merchant/auth/login')
        .send({ username: 'local_cashier', password: 'wrong-password' }).expect(429);
    });

    await t.test('LINE webhook duplicate remains deduplicated after handler recreation', async () => {
      const secret = 'durable-webhook-test-secret';
      let handled = 0;
      const payload = Buffer.from(JSON.stringify({ events: [{ type: 'follow', webhookEventId: 'durable-event-1' }] }));
      const signature = signatureFor(secret, payload);
      const first = createLineWebhook({ secret, db, onEvent: async () => { handled += 1; } });
      assert.deepEqual(await first.handle(payload, signature), { accepted: true, processed: 1, duplicates: 0 });
      const recreated = createLineWebhook({ secret, db, onEvent: async () => { handled += 1; } });
      assert.deepEqual(await recreated.handle(payload, signature), { accepted: true, processed: 0, duplicates: 1 });
      assert.equal(handled, 1);
      assert.equal((await db('line_webhook_events').where({ webhook_event_id: 'durable-event-1' }).first()).status, 'PROCESSED');
      await db('line_webhook_events').where({ webhook_event_id: 'durable-event-1' }).delete();
    });

    fixture = await orderFixture(db);
    const baselineCounter = fixture.merchant.last_order_number;
    fixture.baselineCounter = baselineCounter;

    await t.test('outbox deduplicates, retains provider failure and retries after recreation', async () => {
      let now = Date.now();
      let calls = 0;
      const logger = { error() {} };
      const failing = createNotificationOutbox({
        db, publicAppUrl: 'https://app.example.invalid', logger, now: () => now,
        messaging: { push: async () => { calls += 1; const error = new Error('provider down'); error.code = 'line_unavailable'; throw error; } },
      });
      await db.transaction(async (trx) => {
        await trx('orders').where({ id: fixture.order.id }).update({ status: 'ACCEPTED' });
        await failing.enqueueOrderEvent(trx, 'ORDER_ACCEPTED', fixture.order.id);
        await failing.enqueueOrderEvent(trx, 'ORDER_ACCEPTED', fixture.order.id);
      });
      assert.equal(Number((await db('notification_outbox').where({ order_id: fixture.order.id }).count('* as count').first()).count), 1);
      now += 1000;
      assert.deepEqual(await failing.processNext(), { processed: true, sent: false, retry: true });
      assert.equal((await db('notification_outbox').where({ order_id: fixture.order.id }).first()).status, 'RETRY');
      now += 6000;
      const recreated = createNotificationOutbox({
        db, publicAppUrl: 'https://app.example.invalid', logger, now: () => now,
        messaging: { push: async () => { calls += 1; return { sent: true }; } },
      });
      assert.deepEqual(await recreated.processNext(), { processed: true, sent: true, disabled: false });
      const sent = await db('notification_outbox').where({ order_id: fixture.order.id }).first();
      assert.equal(sent.status, 'SENT');
      assert.equal(sent.attempts, 2);
      assert.equal(calls, 2);
    });

    await t.test('expired private object is deleted through S3 adapter and ledger row is retained', async () => {
      const objects = new Set();
      const client = { send: async (command) => {
        if (command.constructor.name === 'PutObjectCommand') objects.add(command.input.Key);
        if (command.constructor.name === 'DeleteObjectCommand') objects.delete(command.input.Key);
        return {};
      } };
      const storage = createObjectSlipStorage({ objectStorageBucket: 'private-slips' }, {
        client,
        randomUUID: () => '12345678-1234-4123-8123-123456789abc',
        now: () => Date.UTC(2026, 9, 2),
      });
      const [payment] = await db('payments').insert({
        order_id: fixture.order.id, method: 'PROMPTPAY', status: 'FAILED', verification_status: 'ERROR',
        expected_amount: fixture.order.total_amount, provider: 'test',
      }).returning('id');
      const stored = await storage.put({
        paymentId: payment.id, contentType: 'image/png',
        buffer: Buffer.from('89504e470d0a1a0a5041594d454e54', 'hex'),
      });
      const [slip] = await db('payment_slips').insert({
        payment_id: payment.id, object_key: stored.objectKey, file_hash: stored.fileHash,
        purge_after: new Date(Date.now() - 1000),
      }).returning('id');
      const retention = createSlipRetention({ db, storage });
      assert.equal(await retention.purgeBatch(), 1);
      assert.ok((await db('payment_slips').where({ id: slip.id }).first()).deleted_at);
      assert.equal(objects.has(stored.objectKey), false);
      assert.ok(await db('payments').where({ id: payment.id }).first());
    });
  } finally {
    if (fixture) await cleanupOrder(db, fixture.order.id, fixture.merchant.id, fixture.baselineCounter);
    await db('line_webhook_events').where({ webhook_event_id: 'durable-event-1' }).delete();
    await db.destroy();
  }
});
