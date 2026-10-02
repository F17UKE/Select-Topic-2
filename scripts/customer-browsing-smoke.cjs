// Local-only smoke check against the seeded PostgreSQL database. Never targets Cloud Lab.
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
require('../backend/src/env.cjs');
const { createDatabase } = require('../backend/src/database.cjs');

const root = path.resolve(__dirname, '..');

async function unusedPort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
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

async function getJson(origin, pathName, cookie) {
  const response = await fetch(`${origin}${pathName}`, { headers: cookie ? { cookie } : {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function sendJson(origin, pathName, method, cookie, data) {
  const response = await fetch(`${origin}${pathName}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  assert.ok([200, 201].includes(response.status), JSON.stringify(body));
  return body;
}

async function main() {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DB_NAME, 'select_topic_2_local');
  const port = await unusedPort();
  const backend = spawn(process.execPath, [path.join(root, 'backend/src/server.cjs')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port),
      CUSTOMER_AUTH_MODE: 'mock', ENABLE_DEV_LOGIN: 'true', DEV_CUSTOMER_LINE_USER_ID: 'U_LOCAL_CUSTOMER_001',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let smokeAddressId;
  let originalDefaultId;
  try {
    const origin = `http://127.0.0.1:${port}`;
    const health = await waitFor(`${origin}/api/health`, backend);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).database.status, 'ok');

    const login = await fetch(`${origin}/api/dev/auth/login`, { method: 'POST' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await login.json()).customer.line_user_id, 'U_LOCAL_CUSTOMER_001');

    const profile = await getJson(origin, '/api/customer/profile', cookie);
    assert.equal(profile.customer.display_name, 'Mali Demo');
    const addresses = await getJson(origin, '/api/customer/addresses', cookie);
    assert.ok(addresses.addresses.length >= 2);
    assert.equal(addresses.addresses.filter((address) => address.is_default).length, 1);
    const originalDefault = addresses.addresses.find((address) => address.is_default);
    originalDefaultId = originalDefault.id;

    const updatedProfile = await sendJson(origin, '/api/customer/profile', 'PATCH', cookie, {
      displayName: 'Mali Smoke', phone: '0899999999',
    });
    assert.equal(updatedProfile.customer.display_name, 'Mali Smoke');
    await sendJson(origin, '/api/customer/profile', 'PATCH', cookie, {
      displayName: 'Mali Demo', phone: '0812345678',
    });

    const createdAddress = await sendJson(origin, '/api/customer/addresses', 'POST', cookie, {
      dormitoryId: addresses.addresses[1].dormitory_id,
      label: 'Smoke Test', roomNumber: 'T-1', contactPhone: '0812345678',
      addressDetail: 'Temporary smoke address', isDefault: false,
    });
    smokeAddressId = createdAddress.address.id;
    const editedAddress = await sendJson(origin, `/api/customer/addresses/${smokeAddressId}`, 'PATCH', cookie, { roomNumber: 'T-2' });
    assert.equal(editedAddress.address.room_number, 'T-2');
    const newDefault = await sendJson(origin, `/api/customer/addresses/${smokeAddressId}/default`, 'PUT', cookie);
    assert.equal(newDefault.addresses.find((address) => address.id === smokeAddressId).is_default, true);
    await sendJson(origin, `/api/customer/addresses/${originalDefault.id}/default`, 'PUT', cookie);

    const listing = await getJson(origin, `/api/merchants?addressId=${addresses.addresses[0].id}`, cookie);
    assert.equal(listing.merchants.length, 3);
    assert.ok(listing.merchants.every((merchant) => merchant.delivery));
    const search = await getJson(origin, '/api/merchants?q=Tom%20Yum', cookie);
    assert.deepEqual(search.merchants.map((merchant) => merchant.store_name), ['Soi Noodle House']);
    const storeSearch = await getJson(origin, '/api/merchants?q=Green%20Bowl', cookie);
    assert.deepEqual(storeSearch.merchants.map((merchant) => merchant.store_name), ['Green Bowl']);

    const merchant = await getJson(origin, `/api/merchants/${search.merchants[0].id}`, cookie);
    assert.ok(merchant.merchant.gallery.length >= 2);
    assert.ok(merchant.merchant.categories.length >= 2);
    const itemId = merchant.merchant.categories.flatMap((category) => category.items)
      .find((item) => item.name === 'Tom Yum Noodles').id;
    const item = await getJson(origin, `/api/menu-items/${itemId}`, cookie);
    assert.ok(item.menu_item.option_groups.some((group) => group.is_required && group.choices.length >= 2));

    const cart = await fetch(`${origin}/api/cart`, { headers: { cookie } });
    assert.equal(cart.status, 404);
    console.log('PASS local feature smoke: auth, profile writes, address CRUD/default, merchants, fees, search, menu options and DB');
  } finally {
    if (backend.exitCode === null) {
      const exited = once(backend, 'exit');
      backend.kill('SIGTERM');
      const timer = setTimeout(() => backend.kill('SIGKILL'), 8000);
      await exited;
      clearTimeout(timer);
    }
    const db = createDatabase(process.env, { required: true });
    try {
      await db.transaction(async (trx) => {
        const customer = await trx('customers').where({ line_user_id: 'U_LOCAL_CUSTOMER_001' }).first('id');
        if (!customer) return;
        await trx('customers').where({ id: customer.id }).update({ display_name: 'Mali Demo', phone: '0812345678' });
        if (smokeAddressId) await trx('customer_addresses').where({ id: smokeAddressId, customer_id: customer.id }).delete();
        if (originalDefaultId) {
          await trx('customer_addresses').where({ customer_id: customer.id }).update({ is_default: false });
          await trx('customer_addresses').where({ id: originalDefaultId, customer_id: customer.id }).update({ is_default: true });
        }
      });
    } finally { await db.destroy(); }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
