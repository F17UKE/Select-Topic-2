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
const { createCartSmoke } = require('./cart-smoke-helper.cjs');

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
  let promotionId;
  let couponId;
  let couponBaselineUsage;
  let phaseIReviewId;
  let phaseIAdminId;
  let phaseIAdminSessionBaseline;
  let favoriteExisted = false;
  const phaseI = process.argv.includes('--phase-i');
  const idempotencyKey = `payment-smoke-${crypto.randomUUID()}`;
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
    if (phaseI) {
      phaseIAdminId = (await db('platform_admins').where({ username: 'local_super_admin' }).first('id')).id;
      phaseIAdminSessionBaseline = Number((await db('platform_admin_sessions').max('id as id').first()).id || 0);
      const favorite = await db('customer_favorite_merchants').where({ customer_id: customer.id, merchant_id: merchantId }).first('id');
      favoriteExisted = Boolean(favorite);
      await json(origin, `/api/customer/favorites/${merchantId}`, { method: 'POST', cookie, body: {} });
      const coupon = await db('coupons').whereRaw('lower(code) = lower(?)', ['WELCOME10']).where({ is_active: true }).whereNull('deleted_at').first();
      assert.ok(coupon, 'Run the local seed before Phase I smoke');
      couponId = coupon.id;
      couponBaselineUsage = coupon.usage_count;
    }
    if (process.argv.includes('--promotion')) {
      [{ id: promotionId }] = await db('promotions').insert({ name: 'Local discounted pipeline smoke', merchant_id: merchantId,
        funding_source: 'MERCHANT', promotion_type: 'PERCENTAGE', value: 10, minimum_order_amount: 0,
        starts_at: new Date(Date.now() - 60000), ends_at: new Date(Date.now() + 3600000), usage_limit: 1,
      }).returning('id');
    }
    const item = await db('menu_items').where({ merchant_id: merchant.id, name: 'Local Basil Rice' }).first('id');
    const choice = await db('menu_option_choices as c').join('menu_option_groups as g', 'g.id', 'c.option_group_id')
      .where({ 'g.menu_item_id': item.id, 'g.name': 'Spiciness', 'c.name': 'Mild' }).first('c.id');
    const listing = await json(origin, `/api/merchants?addressId=${address.id}`, { cookie });
    assert.ok(listing.merchants.some((row) => row.id === merchantId));
    assert.equal((await json(origin, `/api/merchants/${merchantId}?addressId=${address.id}`, { cookie })).merchant.id, merchantId);
    assert.ok((await json(origin, `/api/merchants/${merchantId}/menu`, { cookie })).categories.length);
    const menu = (await json(origin, `/api/menu-items/${item.id}`, { cookie })).menu_item;
    assert.equal(menu.id, item.id);
    const cart = createCartSmoke();
    assert.equal(cart().addOrUpdate({ merchantId, merchantName: merchant.store_name, menuItemId: menu.id,
      quantity: 1, note: 'Local E2E kitchen note', optionChoiceIds: [choice.id], choices: [], unitPriceEstimate: menu.price }), true);
    assert.equal(cart().count, 1);
    const payload = { merchantId: cart().cart.merchantId, promotionId, couponCode: phaseI ? 'WELCOME10' : undefined,
      addressId: address.id, deliveryType: 'DELIVERY', deliveryNote: 'Local E2E delivery note',
      items: cart().cart.items.map(({ menuItemId, quantity, note, optionChoiceIds }) => ({ menuItemId, quantity, note, optionChoiceIds })) };
    const quote = (await json(origin, '/api/orders/quote', { method: 'POST', cookie, body: payload })).quote;
    const created = await json(origin, '/api/orders', {
      method: 'POST', cookie, headers: { 'idempotency-key': idempotencyKey },
      body: payload,
    });
    orderId = created.order.id;
    assert.equal(created.order.total_amount, quote.total_amount);
    cart().clear();
    assert.equal(cart().count, 0);
    assert.equal(created.order.payment_status, 'UNPAID');
    if (promotionId) {
      assert.ok(created.order.discount_amount > 0);
      assert.equal(created.order.total_amount, created.order.subtotal_amount + created.order.delivery_fee - created.order.discount_amount);
    }
    if (phaseI) {
      assert.ok(created.order.discount_amount > 0);
      assert.equal(created.order.coupon_snapshot.code, 'WELCOME10');
    }
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
    const kitchenLogin = await fetch(`${origin}/api/dev/merchant/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'local_kitchen' }),
    });
    assert.equal(kitchenLogin.status, 200);
    const kitchenCookie = kitchenLogin.headers.get('set-cookie').split(';')[0];
    for (const orderItem of preparing.order.items) {
      await json(origin, `/api/merchant/orders/${orderId}/items/${orderItem.id}`, {
        method: 'PATCH', cookie: kitchenCookie, body: { completed: true },
      });
    }
    const ready = await json(origin, `/api/merchant/orders/${orderId}/ready`, { method: 'POST', cookie: kitchenCookie, body: {} });
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
    if (phaseI) {
      const review = await json(origin, `/api/orders/${orderId}/review`, {
        method: 'POST', cookie, body: { rating: 5, comment: 'Phase I fresh end-to-end scenario' },
      });
      phaseIReviewId = review.review.id;
      const reorder = await json(origin, `/api/orders/${orderId}/reorder-preview`, { method: 'POST', cookie, body: {} });
      assert.ok(reorder.available_items.length > 0);
      const notifications = await json(origin, '/api/customer/notifications', { cookie });
      assert.ok(notifications.items.some((item) => item.order_id === orderId));

      const adminLogin = await fetch(`${origin}/api/admin/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'local_super_admin', password: 'local-admin-only' }),
      });
      assert.equal(adminLogin.status, 200);
      const adminLoginBody = await adminLogin.json();
      const adminCookie = adminLogin.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      assert.equal((await json(origin, `/api/admin/orders/${orderId}`, { cookie: adminCookie })).order.id, orderId);
      const adminReviews = await json(origin, '/api/admin/reviews?status=PUBLISHED', { cookie: adminCookie });
      assert.ok(adminReviews.items.some((item) => item.id === phaseIReviewId));
      await json(origin, `/api/admin/reviews/${phaseIReviewId}`, {
        method: 'PATCH', cookie: adminCookie, headers: { 'x-csrf-token': adminLoginBody.csrf_token }, body: { status: 'HIDDEN' },
      });
      await json(origin, `/api/admin/reviews/${phaseIReviewId}`, {
        method: 'PATCH', cookie: adminCookie, headers: { 'x-csrf-token': adminLoginBody.csrf_token }, body: { status: 'PUBLISHED' },
      });
      const audit = await json(origin, '/api/admin/audit-logs?limit=50', { cookie: adminCookie });
      assert.ok(audit.items.some((item) => item.entity_type === 'REVIEW' && Number(item.entity_id) === phaseIReviewId));
    }
    console.log(`PASS local pipeline smoke${promotionId ? ' with promotion' : ''}${phaseI ? ' Phase I engagement/Admin audit' : ''}: customer paid -> merchant READY/assign -> rider DELIVERING -> COMPLETED -> customer reflects status`);
    console.log(JSON.stringify({ test_order_id: orderId, order_code: created.order.order_code,
      flow: 'browse/menu -> actual client cart -> quote -> order -> mock PAID -> MANAGER accept/preparing -> KITCHEN complete/ready -> MANAGER assign -> RIDER delivering/completed -> customer COMPLETED' }));
  } finally {
    if (backend.exitCode === null) {
      const exited = once(backend, 'exit');
      backend.kill('SIGTERM');
      const timer = setTimeout(() => backend.kill('SIGKILL'), 8000);
      await exited;
      clearTimeout(timer);
    }
    if (orderId) {
      await db('audit_logs').where({ entity_type: 'REVIEW', entity_id: String(phaseIReviewId) }).delete();
      await db('reviews').where({ order_id: orderId }).delete();
      await db('customer_notifications').where({ order_id: orderId }).delete();
      const paymentIds = (await db('payments').where({ order_id: orderId }).select('id')).map((row) => row.id);
      if (paymentIds.length) {
        await db('payment_verifications').whereIn('payment_id', paymentIds).delete();
        await db('payment_slips').whereIn('payment_id', paymentIds).delete();
        await db('payments').whereIn('id', paymentIds).delete();
      }
      const itemIds = (await db('order_items').where({ order_id: orderId }).select('id')).map((row) => row.id);
      if (itemIds.length) await db('order_item_choices').whereIn('order_item_id', itemIds).delete();
      await db('order_items').where({ order_id: orderId }).delete();
      await db('coupon_redemptions').where({ order_id: orderId }).delete();
      await db('promotion_redemptions').where({ order_id: orderId }).delete();
      await db('notification_outbox').where({ order_id: orderId }).delete();
      await db('orders').where({ id: orderId }).delete();
    }
    if (promotionId) await db('promotions').where({ id: promotionId }).delete();
    if (couponId && couponBaselineUsage !== undefined) await db('coupons').where({ id: couponId }).update({ usage_count: couponBaselineUsage });
    if (phaseIAdminId && phaseIAdminSessionBaseline !== undefined) {
      await db('platform_admin_sessions').where({ admin_id: phaseIAdminId }).where('id', '>', phaseIAdminSessionBaseline).delete();
    }
    if (phaseI && !favoriteExisted && merchantId) {
      const customer = await db('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first('id');
      await db('customer_favorite_merchants').where({ customer_id: customer.id, merchant_id: merchantId }).delete();
    }
    await db('idempotency_keys').where({ idempotency_key: idempotencyKey }).delete();
    if (merchantId && baselineCounter !== undefined) await db('merchants').where({ id: merchantId, last_order_number: baselineCounter + 1 }).update({ last_order_number: baselineCounter });
    await db.destroy();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
