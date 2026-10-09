// Read-only Local customer browsing smoke. Login/logout touch only mock in-memory sessions.
// No profile/address/favorite/notification/order/payment mutations; no provider calls.
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';

async function main() {
  let cookie;
  let checks = 0;
  async function get(route) {
    const response = await fetch(`${origin}${route}`, {
      headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200, `GET ${route}`);
    checks++;
    return response.json();
  }
  const health = await get('/api/health');
  assert.equal(health.database.status, 'ok');
  const config = await get('/api/auth/config');
  assert.equal(config.mode, 'mock', 'This test is exclusively for Local mock login');
  assert.equal(config.dev_login_enabled, true);
  try {
    const login = await fetch(`${origin}/api/dev/auth/login`, { method: 'POST' });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    const addresses = await get('/api/customer/addresses');
    const address = addresses.addresses.find((item) => item.is_default) || addresses.addresses[0];
    const listing = await get(`/api/merchants${address ? `?addressId=${encodeURIComponent(address.id)}` : ''}`);
    assert.ok(Array.isArray(listing.merchants));
    const selected = listing.merchants[0];
    if (selected) {
      const detail = await get(`/api/merchants/${selected.id}`);
      const reviews = await get(`/api/merchants/${selected.id}/reviews`);
      assert.ok(Array.isArray(reviews.reviews));
      const menu = detail.merchant.categories.flatMap((category) => category.items)[0];
      if (menu) {
        const item = await get(`/api/menu-items/${menu.id}`);
        assert.equal(String(item.menu_item.id), String(menu.id));
        const menuPage = await fetch(`${origin}/menu/${menu.id}`, { headers: { cookie }, signal: AbortSignal.timeout(30000) });
        assert.equal(menuPage.status, 200);
        assert.ok((await menuPage.text()).includes('<html'));
        checks++;
      }
      const result = await get(`/api/merchants?q=${encodeURIComponent(selected.store_name)}`);
      assert.ok(result.merchants.some((item) => String(item.id) === String(selected.id)));
    }
    for (const route of ['/api/banners/active', '/api/promotions', '/api/customer/favorites', '/api/customer/notifications']) await get(route);
    for (const route of ['/', '/promotions', '/favorites', '/notifications', '/stores/1', '/orders', '/profile', '/cart']) {
      const response = await fetch(`${origin}${route}`, { headers: { cookie }, signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, route);
      assert.ok((await response.text()).includes('<html'));
      checks++;
    }
    console.log(`PASS read-only customer browsing smoke: ${checks} GET checks; business mutation requests = 0`);
  } finally {
    if (cookie) await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
