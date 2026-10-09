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
const { createFinanceService } = require('../src/finance-service.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';
const isolatedLocalDatabase = localDatabase
  && /^-c search_path=p0_test_[a-f0-9]{16}$/.test(process.env.PGOPTIONS || '');
const png = (label) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]);

function appFor(db, lineUserId, storageRoot, dependencies = {}) {
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
      ...dependencies,
    }),
  });
}

async function login(app) {
  const agent = request.agent(app);
  await agent.post('/api/dev/auth/login').expect(200);
  return agent;
}

test('PromptPay payment pipeline: ownership, QR, upload validation, verification and duplicate safety', {
  skip: !isolatedLocalDatabase && 'requires disposable select_topic_2_local schema',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'select-topic-2-slips-'));
  const orderIds = [];
  let secondCustomerId;
  let merchantId;
  let baselineCounter;
  let originalFinanceRuntime;
  try {
    originalFinanceRuntime = await db('system_settings').where({ setting_key: 'finance.runtime' }).first('setting_value');
    if (originalFinanceRuntime) {
      await db('system_settings').where({ setting_key: 'finance.runtime' }).update({
        setting_value: JSON.stringify({ mode: 'LEGACY_MERCHANT_DIRECT' }), updated_at: db.fn.now(),
      });
    }
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
      assert.equal(response.body.payment.slip.object_key, undefined);
      const stored = await db('payment_slips').where({ payment_id: response.body.payment.id }).first();
      assert.equal(stored.object_key.startsWith('slips/'), true);
      assert.equal(path.isAbsolute(stored.object_key), false);
      const saved = await db('orders').where({ id: order.id }).first('status', 'payment_status');
      assert.deepEqual(saved, { status: 'PENDING', payment_status: 'PAID' });
      const verification = response.body.payment.verification;
      assert.equal(verification.status, 'VERIFIED');
      assert.equal(verification.provider_response, undefined);
      assert.equal(response.body.payment.transaction_reference, undefined);
      const before = await db('payment_verifications').where({ payment_id: response.body.payment.id }).count('* as n').first();
      const replay = await upload(order.id, 'repeat', { mockScenario: 'success' });
      assert.equal(replay.body.payment.status, 'PAID');
      assert.deepEqual(await db('payment_verifications').where({ payment_id: response.body.payment.id }).count('* as n').first(), before);
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as count').first()).count), 1);
    });

    await t.test('JPEG/JPG, PNG and WebP signature fixtures pass the existing image boundary', async () => {
      // Signature fixtures exercise storage MIME/magic validation; the provider is mocked.
      for (const [extension, contentType, signature] of [
        ['jpeg', 'image/jpeg', Buffer.from('ffd8ffe0', 'hex')],
        ['jpg', 'image/jpeg', Buffer.from('ffd8ffe0', 'hex')],
        ['png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
        ['webp', 'image/webp', Buffer.from('RIFF0000WEBP')],
      ]) {
        const order = await createOrder();
        await attempt(order.id);
        const image = Buffer.concat([signature, Buffer.from(`format-${order.id}-${extension}`)]);
        const result = await agent.post(`/api/orders/${order.id}/payment/slip`)
          .attach('slip', image, { filename: `slip.${extension}`, contentType }).expect(200);
        assert.equal(result.body.payment.status, 'PAID');
      }
    });

    await t.test('rejects unauthorized, unsupported, forged and oversized uploads', async () => {
      const order = await createOrder();
      await attempt(order.id);
      await otherAgent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', png('other'), { filename: 'other.png', contentType: 'image/png' }).expect(404);
      await otherAgent.post(`/api/orders/${order.id}/payment/reconcile`).send({}).expect(404);
      await agent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', Buffer.from('plain text'), { filename: 'fake.png', contentType: 'text/plain' }).expect(415);
      await agent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', Buffer.from('not a png'), { filename: 'fake.png', contentType: 'image/png' }).expect(415);
      for (const contentType of ['application/pdf', 'image/gif', 'image/svg+xml', 'image/heic', 'image/heif', 'application/zip', 'application/msword', 'text/plain', 'application/x-msdownload']) {
        await agent.post(`/api/orders/${order.id}/payment/slip`)
          .attach('slip', png('false-extension'), { filename: 'slip.jpg', contentType }).expect(415);
      }
      await agent.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', Buffer.from('%PDF-1.7\nnot-a-jpeg'), { filename: 'slip.jpg', contentType: 'image/jpeg' }).expect(415);
      await agent.post(`/api/orders/${order.id}/payment/slip`).send({}).expect(400);
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
        if (scenario === 'provider_error') {
          assert.equal(retry.id, first.id, 'transport retry retains the unique image claim');
          const retried = await agent.post(`/api/orders/${order.id}/payment/reconcile`).send({}).expect(200);
          assert.equal(retried.body.payment.status, 'PAID');
          assert.equal(Number((await db('payment_slips').where({ payment_id: first.id }).count('* as n').first()).n), 1);
        } else assert.notEqual(retry.id, first.id);
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
      assert.ok(results.some((result) => result.status === 200));
      assert.ok(results.every((result) => [200, 409].includes(result.status)));
      const payment = await db('payments').where({ order_id: order.id }).first();
      assert.equal(Number((await db('payment_verifications').where({ payment_id: payment.id }).count('* as n').first()).n), 1);
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as count').first()).count), 1);
      assert.equal((await db('orders').where({ id: order.id }).first('status')).status, 'PENDING');
    });

    await t.test('outbox failure rolls back PAID and ledger, and replay never duplicates outbox', async () => {
      const order = await createOrder();
      await attempt(order.id);
      const outbox = require('../src/notification-outbox.cjs').createNotificationOutbox({ db, publicAppUrl: 'http://localhost', messaging: {} });
      const failing = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot, { notifier: {
        async enqueueOrderEvent(trx, event, id) { await outbox.enqueueOrderEvent(trx, event, id); throw new Error('synthetic_rollback'); },
      } }));
      await failing.post(`/api/orders/${order.id}/payment/slip`).attach('slip', png('rollback'), { filename: 'slip.png', contentType: 'image/png' }).expect(500);
      assert.notEqual((await db('orders').where({ id: order.id }).first()).payment_status, 'PAID');
      assert.equal((await db('payments').where({ order_id: order.id }).first()).transaction_reference, null);
      assert.equal(Number((await db('notification_outbox').where({ order_id: order.id }).count('* as n').first()).n), 0);
      const staged = await db('payment_verifications').where({ payment_id: (await db('payments').where({ order_id: order.id }).first()).id }).orderBy('id', 'desc').first();
      assert.equal(staged.status, 'PROCESSING');
      assert.ok(staged.provider_transaction_reference, 'validated provider result remains durable for reconciliation');
      assert.equal(staged.amount_matches, true);
      assert.equal(staged.recipient_matches, true);
      const recovery = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot, { verifier: {
        name: 'must-not-call-provider',
        async verify() { throw new Error('provider_must_not_be_called_for_staged_result'); },
      } }));
      const reconciled = await recovery.post(`/api/orders/${order.id}/payment/reconcile`).send({}).expect(200);
      assert.equal(reconciled.body.payment.status, 'PAID');
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as n').first()).n), 1);

      const success = await createOrder(); await attempt(success.id);
      const notified = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot, { notifier: outbox }));
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await notified.post(`/api/orders/${success.id}/payment/slip`).attach('slip', png('notified'), { filename: 'slip.png', contentType: 'image/png' }).expect(200);
        assert.equal(response.body.payment.status, 'PAID');
      }
      assert.equal(Number((await db('notification_outbox').where({ order_id: success.id }).count('* as n').first()).n), 1);
    });

    await t.test('EasySlip normalized results reach the real payment transaction, without live network', async () => {
      const { createEasyslipProvider } = require('../src/payment-verifiers/easyslip-provider.cjs');
      const config = { verificationMode: 'easyslip', maxUploadBytes: 4194304, retentionHours: 24,
        easyslipApiBaseUrl: 'https://api.easyslip.com/v2', easyslipApiKey: 'synthetic-only',
        easyslipMerchantAccounts: { [merchant.id]: { promptpayType: merchant.promptpay_identifier_type,
          promptpayId: merchant.promptpay_id, bankCode: '999', bankNumber: '0000000099' } } };
      for (const outcome of ['success', 'amount', 'receiver', 'duplicate', 'invalid']) {
        const order = await createOrder();
        let calls = 0;
        const verifier = createEasyslipProvider(config, { request: async (options) => {
          calls++;
          assert.equal(options.fields.matchAmount, Number(order.total_amount).toFixed(2));
          assert.equal(options.fields.remark, order.order_code);
          const payload = { success: true, data: { isDuplicate: outcome === 'duplicate', isAmountMatched: true,
            matchedAccount: { bank: { code: '999' }, bankNumber: outcome === 'receiver' ? '0000000088' : '0000000099' },
            amountInOrder: order.total_amount, amountInSlip: outcome === 'amount' ? 1 : order.total_amount,
            rawSlip: { date: '2026-10-01T00:00:00Z', transRef: `EASY-FIXTURE-${order.id}`, amount: { amount: order.total_amount },
              receiver: { bank: { id: '999' }, account: { bank: { account: '0000000099' } } } } } };
          return { statusCode: outcome === 'invalid' ? 404 : 200,
            body: JSON.stringify(outcome === 'invalid' ? { success: false, error: { code: 'SLIP_NOT_FOUND' } } : payload) };
        } });
        const client = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot, { config, verifier }));
        await client.post(`/api/orders/${order.id}/payments`).send({ expectedAmount: 1 }).expect(201);
        await client.post(`/api/orders/${order.id}/payment/slip`)
          .attach('slip', Buffer.alloc(4194305), { filename: 'oversize.png', contentType: 'image/png' }).expect(413);
        assert.equal(calls, 0);
        const response = await client.post(`/api/orders/${order.id}/payment/slip`).field('amount', '1')
          .attach('slip', png(`easy-${outcome}`), { filename: 'slip.png', contentType: 'image/png' }).expect(200);
        assert.equal(response.body.payment.status, outcome === 'success' ? 'PAID' : 'FAILED');
        if (outcome === 'duplicate') {
          assert.equal(response.body.payment.verification.failure_code, 'DUPLICATE_TRANSACTION_REFERENCE');
          assert.equal((await db('orders').where({ id: order.id }).first('payment_status')).payment_status, 'FAILED');
        }
        if (outcome === 'success') {
          await client.post(`/api/orders/${order.id}/payment/slip`).attach('slip', png('easy-repeat'), { filename: 'slip.png', contentType: 'image/png' }).expect(200);
          assert.equal(calls, 1, 'paid replay must not call the provider again');
          assert.equal(response.body.payment.amount_transferred, order.total_amount);
        }
      }
    });

    const financeOwner = await db('platform_admins').where({ role: 'SUPER_ADMIN', is_active: true }).whereNull('deleted_at').first();
    await createFinanceService(db).configure(financeOwner, {
      mode: 'PLATFORM_CENTRALIZED', confirm: true, promptpayType: 'PHONE', promptpayId: '0800000099',
      displayName: 'Synthetic payment integration', bankCode: '999', bankNumber: '0000000099',
    });

    await t.test('EasySlip duplicate is accepted only for the same stored payment reconciliation', async () => {
      const { createEasyslipProvider } = require('../src/payment-verifiers/easyslip-provider.cjs');
      const config = { verificationMode: 'easyslip', maxUploadBytes: 4194304, retentionHours: 24,
        easyslipApiBaseUrl: 'https://api.easyslip.com/v2', easyslipApiKey: 'synthetic-only',
        easyslipMerchantAccounts: { [merchant.id]: { promptpayType: merchant.promptpay_identifier_type,
          promptpayId: merchant.promptpay_id, bankCode: '999', bankNumber: '0000000099' } } };
      const order = await createOrder();
      const reference = `EASY-RETRY-${order.id}`;
      let calls = 0;
      const verifier = createEasyslipProvider(config, { request: async () => {
        calls++;
        if (calls === 1) throw new Error('synthetic transport loss');
        return { statusCode: 200, body: JSON.stringify({ success: true, data: {
          isDuplicate: true, isAmountMatched: true, amountInOrder: order.total_amount, amountInSlip: order.total_amount,
          matchedAccount: { bank: { code: 'PROMPTPAY' }, bankNumber: '0800000099' },
          rawSlip: { date: '2026-10-01T00:00:00Z', transRef: reference, amount: { amount: order.total_amount },
            receiver: { bank: { id: 'PROMPTPAY' }, account: { proxy: { type: 'MSISDN', account: '******0099' } } } },
        } }) };
      } });
      const client = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot, { config, verifier }));
      const payment = (await client.post(`/api/orders/${order.id}/payments`).send({}).expect(201)).body.payment;
      const failed = await client.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', png('easy-own-retry'), { filename: 'slip.png', contentType: 'image/png' }).expect(200);
      assert.equal(failed.body.payment.verification_status, 'ERROR');
      assert.equal((await client.post(`/api/orders/${order.id}/payments`).send({}).expect(201)).body.payment.id, payment.id);
      const reconciled = await client.post(`/api/orders/${order.id}/payment/reconcile`).send({}).expect(200);
      assert.equal(reconciled.body.payment.status, 'PAID');
      assert.equal(calls, 2);
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as n').first()).n), 1);
      assert.equal(Number((await db('financial_transactions').where({ event_key: `ORDER_PAID:${order.id}` }).count('* as n').first()).n), 1);
      const replay = await client.post(`/api/orders/${order.id}/payment/reconcile`).send({}).expect(200);
      assert.equal(replay.body.payment.status, 'PAID');
      assert.equal(calls, 2, 'paid reconciliation replay must not call EasySlip again');
      assert.equal(Number((await db('financial_transactions').where({ event_key: `ORDER_PAID:${order.id}` }).count('* as n').first()).n), 1);
    });

    await t.test('a legacy newer empty attempt cannot hide the same order stored-slip recovery', async () => {
      const order = await createOrder();
      const reference = `EASY-STORED-${order.id}`;
      let calls = 0;
      const verifier = {
        name: 'easyslip-v2',
        preflight() {},
        async verify(input) {
          calls++;
          const recipientVerified = calls > 1;
          return {
            provider: 'easyslip-v2', providerRequestId: `stored-${calls}`,
            status: recipientVerified ? 'VERIFIED' : 'REJECTED',
            failureCode: recipientVerified ? null : 'RECIPIENT_MISMATCH',
            transactionReference: reference, amount: input.expectedAmount,
            providerDuplicate: recipientVerified,
            recipient: { type: input.expectedRecipientType, value: input.expectedRecipient },
            recipientVerified, merchantId: input.merchantId,
            rawRedacted: { amount_matches: true, recipient_matches: recipientVerified },
          };
        },
      };
      const client = await login(appFor(db, 'U_LOCAL_CUSTOMER_001', storageRoot, { verifier }));
      const original = (await client.post(`/api/orders/${order.id}/payments`).send({}).expect(201)).body.payment;
      const rejected = await client.post(`/api/orders/${order.id}/payment/slip`)
        .attach('slip', png('legacy-stored-slip'), { filename: 'slip.png', contentType: 'image/png' }).expect(200);
      assert.equal(rejected.body.payment.verification.failure_code, 'RECIPIENT_MISMATCH');
      const pinned = await db('payments').where({ id: original.id }).first('payment_recipient_version_id', 'expected_amount');
      const [emptyAttempt] = await db('payments').insert({
        order_id: order.id, payment_recipient_version_id: pinned.payment_recipient_version_id,
        method: 'PROMPTPAY', status: 'PENDING', verification_status: 'PENDING',
        expected_amount: pinned.expected_amount, provider: verifier.name,
      }).returning('id');
      assert.notEqual(emptyAttempt.id, original.id);
      assert.equal((await client.get(`/api/orders/${order.id}/payment`).expect(200)).body.payment.id, original.id);
      assert.equal((await client.post(`/api/orders/${order.id}/payments`).send({}).expect(201)).body.payment.id, original.id);
      const reconciled = await client.post(`/api/orders/${order.id}/payment/reconcile`).send({}).expect(200);
      assert.equal(reconciled.body.payment.id, original.id);
      assert.equal(reconciled.body.payment.status, 'PAID');
      assert.equal(calls, 2);
      assert.equal(Number((await db('payment_slips').where({ payment_id: original.id }).count('* as n').first()).n), 1);
      assert.equal(Number((await db('payments').where({ order_id: order.id, status: 'PAID' }).count('* as n').first()).n), 1);
      assert.equal(Number((await db('financial_transactions').where({ event_key: `ORDER_PAID:${order.id}` }).count('* as n').first()).n), 1);
    });
  } finally {
    // The suite now exercises immutable centralized finance history. Its disposable schema is
    // dropped by isolated-local-verification; deleting journal rows would correctly be rejected.
    if (!isolatedLocalDatabase && originalFinanceRuntime) {
      await db('system_settings').where({ setting_key: 'finance.runtime' }).update({
        setting_value: JSON.stringify(originalFinanceRuntime.setting_value), updated_at: db.fn.now(),
      });
    }
    if (!isolatedLocalDatabase && orderIds.length) {
      await db('notification_outbox').whereIn('order_id', orderIds).delete();
      await db('customer_notifications').whereIn('order_id', orderIds).delete();
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
    if (!isolatedLocalDatabase && merchantId && baselineCounter !== undefined) {
      await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounter });
    }
    if (!isolatedLocalDatabase && secondCustomerId) await db('customers').where({ id: secondCustomerId }).delete();
    await db.destroy();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
