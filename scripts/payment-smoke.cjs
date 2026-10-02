// End-to-end local API smoke for order -> PromptPay QR -> slip -> paid. Never targets Cloud Lab.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
require('../backend/src/env.cjs');
const { createDatabase } = require('../backend/src/database.cjs');

const root = path.resolve(__dirname, '..');

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Backend exited with code ${child.exitCode}`);
    try { return await fetch(url, { signal: AbortSignal.timeout(2000) }); }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function json(origin, pathName, { method = 'GET', cookie, body, headers = {} } = {}) {
  const response = await fetch(`${origin}${pathName}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`);
  return result;
}

async function main() {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DB_NAME, 'select_topic_2_local');
  const port = await unusedPort();
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'select-topic-2-payment-smoke-'));
  const backend = spawn(process.execPath, [path.join(root, 'backend/src/server.cjs')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port),
      CUSTOMER_AUTH_MODE: 'mock', ENABLE_DEV_LOGIN: 'true', DEV_CUSTOMER_LINE_USER_ID: 'U_LOCAL_CUSTOMER_001',
      MERCHANT_STAFF_AUTH_MODE: 'mock', ENABLE_STAFF_DEV_LOGIN: 'true',
      PAYMENT_VERIFICATION_MODE: 'mock', SLIP_STORAGE_DIR: storageRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const db = createDatabase(process.env, { required: true });
  let orderId;
  let merchantId;
  let baselineCounter;
  try {
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await waitFor(`${origin}/api/health`, backend)).status, 200);
    const login = await fetch(`${origin}/api/dev/auth/login`, { method: 'POST' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first('id');
    const address = await db('customer_addresses').where({ customer_id: customer.id, is_default: true }).first('id');
    const merchant = await db('merchants').where({ prefix: 'LOC' }).first();
    merchantId = merchant.id;
    baselineCounter = merchant.last_order_number;
    const item = await db('menu_items').where({ merchant_id: merchant.id, name: 'Local Basil Rice' }).first('id');
    const choice = await db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .where({ 'g.menu_item_id': item.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
    const created = await json(origin, '/api/orders', {
      method: 'POST', cookie, headers: { 'idempotency-key': `payment-smoke-${crypto.randomUUID()}` },
      body: { merchantId, addressId: address.id, deliveryType: 'DELIVERY', items: [{ menuItemId: item.id, quantity: 1, optionChoiceIds: [choice.id] }] },
    });
    orderId = created.order.id;
    assert.equal(created.order.payment_status, 'UNPAID');
    const attempt = await json(origin, `/api/orders/${orderId}/payments`, { method: 'POST', cookie, body: {} });
    assert.equal(attempt.payment.expected_amount, created.order.total_amount);
    const qr = await json(origin, `/api/orders/${orderId}/payment/qr`, { cookie });
    assert.equal(qr.qr.amount, created.order.total_amount);
    assert.match(qr.qr.image_data_url, /^data:image\/png;base64,/);
    const form = new FormData();
    form.append('mockScenario', 'success');
    form.append('mockTransactionReference', `SMOKE-${crypto.randomUUID()}`);
    form.append('slip', new Blob([Buffer.from('89504e470d0a1a0a5041594d454e542d534d4f4b45', 'hex')], { type: 'image/png' }), 'slip.png');
    const paid = await json(origin, `/api/orders/${orderId}/payment/slip`, { method: 'POST', cookie, body: form });
    assert.equal(paid.payment.status, 'PAID');
    const finalOrder = await json(origin, `/api/orders/${orderId}`, { cookie });
    assert.equal(finalOrder.order.payment_status, 'PAID');
    assert.equal(finalOrder.order.status, 'PENDING');
    const staffLogin = await fetch(`${origin}/api/dev/merchant/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'local_manager' }),
    });
    assert.equal(staffLogin.status, 200);
    const staffCookie = staffLogin.headers.get('set-cookie').split(';')[0];
    const merchantList = await json(origin, '/api/merchant/orders', { cookie: staffCookie });
    assert.ok(merchantList.orders.some((order) => order.id === orderId));
    await json(origin, `/api/merchant/orders/${orderId}/accept`, { method: 'POST', cookie: staffCookie, body: {} });
    const preparing = await json(origin, `/api/merchant/orders/${orderId}/start-preparing`, { method: 'POST', cookie: staffCookie, body: {} });
    for (const orderItem of preparing.order.items) {
      await json(origin, `/api/merchant/orders/${orderId}/items/${orderItem.id}`, {
        method: 'PATCH', cookie: staffCookie, body: { completed: true },
      });
    }
    const ready = await json(origin, `/api/merchant/orders/${orderId}/ready`, { method: 'POST', cookie: staffCookie, body: {} });
    assert.equal(ready.order.status, 'READY');
    assert.equal(ready.order.payment_status, 'PAID');
    const riders = await json(origin, '/api/merchant/riders', { cookie: staffCookie });
    const localRider = riders.riders.find((rider) => rider.username === 'local_rider');
    assert.ok(localRider);
    const assigned = await json(origin, `/api/merchant/orders/${orderId}/assign-rider`, {
      method: 'POST', cookie: staffCookie, body: { riderId: localRider.id },
    });
    assert.equal(assigned.order.assigned_rider.id, localRider.id);
    const riderLogin = await fetch(`${origin}/api/dev/merchant/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'local_rider' }),
    });
    assert.equal(riderLogin.status, 200);
    const riderCookie = riderLogin.headers.get('set-cookie').split(';')[0];
    const riderList = await json(origin, '/api/rider/orders', { cookie: riderCookie });
    assert.ok(riderList.orders.some((order) => order.id === orderId));
    const delivering = await json(origin, `/api/rider/orders/${orderId}/start-delivery`, {
      method: 'POST', cookie: riderCookie, body: {},
    });
    assert.equal(delivering.order.status, 'DELIVERING');
    const completed = await json(origin, `/api/rider/orders/${orderId}/complete`, {
      method: 'POST', cookie: riderCookie, body: {},
    });
    assert.equal(completed.order.status, 'COMPLETED');
    assert.ok(completed.order.completed_at);
    const customerCompleted = await json(origin, `/api/orders/${orderId}`, { cookie });
    assert.equal(customerCompleted.order.status, 'COMPLETED');
    console.log('PASS local pipeline smoke: customer paid -> merchant READY/assign -> rider DELIVERING -> COMPLETED -> customer reflects status');
  } finally {
    if (backend.exitCode === null) {
      const exited = once(backend, 'exit');
      backend.kill('SIGTERM');
      const timer = setTimeout(() => backend.kill('SIGKILL'), 8000);
      await exited;
      clearTimeout(timer);
    }
    if (orderId) {
      const paymentIds = (await db('payments').where({ order_id: orderId }).select('id')).map((row) => row.id);
      if (paymentIds.length) {
        await db('payment_verifications').whereIn('payment_id', paymentIds).delete();
        await db('payment_slips').whereIn('payment_id', paymentIds).delete();
        await db('payments').whereIn('id', paymentIds).delete();
      }
      const itemIds = (await db('order_items').where({ order_id: orderId }).select('id')).map((row) => row.id);
      if (itemIds.length) await db('order_item_choices').whereIn('order_item_id', itemIds).delete();
      await db('order_items').where({ order_id: orderId }).delete();
      await db('orders').where({ id: orderId }).delete();
    }
    if (merchantId && baselineCounter !== undefined) await db('merchants').where({ id: merchantId }).update({ last_order_number: baselineCounter });
    await db.destroy();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
