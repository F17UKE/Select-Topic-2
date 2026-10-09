const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createCustomerAuth } = require('../src/auth.cjs');
const { createMerchantStaffAuth } = require('../src/staff-auth.cjs');
const { createApp } = require('../src/app.cjs');

const lifetime = 8 * 60 * 60 * 1000;
function fakeDb(row) {
  return () => {
    const query = {};
    for (const name of ['join', 'select', 'where', 'whereRaw', 'whereNull']) query[name] = () => query;
    query.first = async () => ({ ...row });
    return query;
  };
}
const cookieRequest = (cookie) => ({ get: (name) => name === 'cookie' ? cookie : undefined });
const unauthorized = (error) => error.status === 401 && /authentication_required$/.test(error.code);

test('customer server expiry: fresh, just-before, exact boundary, after, logout and re-login', async () => {
  let clock = Date.now();
  const auth = createCustomerAuth({ db: fakeDb({ id: 1 }), now: () => clock,
    config: { mode: 'mock', devLoginEnabled: true, secureCookie: false } });
  const first = await auth.loginDevelopmentCustomer();
  const req = cookieRequest(`customer_session=${first.token}`);
  assert.match(auth.cookie(first.token), /Max-Age=28800/);
  assert.equal((await auth.authenticate(req)).customer.id, 1);
  clock += lifetime - 1;
  assert.equal((await auth.authenticate(req)).customer.id, 1);
  clock += 1;
  await assert.rejects(auth.authenticate(req), unauthorized);
  clock += 3600000;
  await assert.rejects(auth.authenticate(req), unauthorized);
  const fresh = await auth.loginDevelopmentCustomer();
  assert.notEqual(fresh.token, first.token);
  assert.equal((await auth.authenticate(cookieRequest(`customer_session=${fresh.token}`))).customer.id, 1);
  auth.logout(fresh.token);
  await assert.rejects(auth.authenticate(cookieRequest(`customer_session=${fresh.token}`)), unauthorized);
});

test('verified LINE login gets the same bounded secure server session, including Bearer access', async () => {
  let clock = Date.now();
  const auth = createCustomerAuth({ db: fakeDb({ id: 1, phone: 'synthetic' }), now: () => clock,
    config: { mode: 'line', lineChannelId: 'test-channel', secureCookie: true },
    identityProvider: { verifyIdToken: async () => ({ aud: 'test-channel', iss: 'https://access.line.me', sub: 'U_TEST', exp: Math.floor(clock / 1000) + 60 }) } });
  const session = await auth.loginLineCustomer('synthetic-verified-token');
  const req = { get: (name) => name === 'authorization' ? `Bearer ${session.token}` : undefined };
  assert.equal((await auth.authenticate(req)).customer.id, 1);
  assert.match(auth.cookie(session.token), /HttpOnly; SameSite=Lax.*Secure/);
  clock += lifetime;
  await assert.rejects(auth.authenticate(req), unauthorized);
});

test('staff password sessions preserve roles, expire at eight hours and keep regeneration/revocation', async () => {
  const password = 'synthetic-session-test';
  const password_hash = await bcrypt.hash(password, 4);
  for (const role of ['MANAGER', 'CASHIER', 'KITCHEN', 'RIDER']) {
    let clock = Date.now();
    const auth = createMerchantStaffAuth({ db: fakeDb({ id: 2, merchant_id: 1, username: 'fixture', role, password_hash }),
      config: { mode: 'password', secureCookie: true }, now: () => clock });
    const first = await auth.loginPassword('fixture', password);
    const req = cookieRequest(`merchant_staff_session=${first.token}`);
    assert.equal((await auth.authenticate(req)).staff.role, role);
    assert.equal(first.staff.password_hash, undefined);
    assert.match(auth.cookie(first.token), /Max-Age=28800; Secure/);
    clock += lifetime - 1;
    assert.equal((await auth.authenticate(req)).staff.role, role);
    clock += 1;
    await assert.rejects(auth.authenticate(req), unauthorized);
    const second = await auth.loginPassword('fixture', password);
    const third = await auth.loginPassword('fixture', password, { currentToken: second.token });
    await assert.rejects(auth.authenticate(cookieRequest(`merchant_staff_session=${second.token}`)), unauthorized);
    auth.revokeStaff(2);
    await assert.rejects(auth.authenticate(cookieRequest(`merchant_staff_session=${third.token}`)), unauthorized);
    const last = await auth.loginPassword('fixture', password);
    auth.logout(last.token);
    await assert.rejects(auth.authenticate(cookieRequest(`merchant_staff_session=${last.token}`)), unauthorized);
  }
});

test('mock staff sessions also expire; malformed and nonexistent cookies produce sanitized 401', async () => {
  let clock = Date.now();
  const staffAuth = createMerchantStaffAuth({ db: fakeDb({ id: 2 }), now: () => clock,
    config: { mode: 'mock', devLoginEnabled: true, defaultUsername: 'fixture' } });
  const session = await staffAuth.loginDevelopmentStaff();
  const req = cookieRequest(`merchant_staff_session=${session.token}`);
  await staffAuth.authenticate(req);
  clock += lifetime + 1;
  await assert.rejects(staffAuth.authenticate(req), unauthorized);
  const auth = createCustomerAuth({ db: fakeDb({ id: 1 }), config: { mode: 'mock' } });
  const app = createApp({ auth, customers: {}, stores: {}, staffAuth, merchantOrders: {}, checkDatabase: async () => ({ status: 'ok' }) });
  for (const token of ['%E0%A4%A', '%', 'missing-token']) {
    const c = await request(app).get('/api/auth/me').set('Cookie', `customer_session=${token}`).expect(401);
    assert.equal(c.body.error, 'authentication_required');
    const s = await request(app).get('/api/merchant/auth/me').set('Cookie', `merchant_staff_session=${token}`).expect(401);
    assert.equal(s.body.error, 'staff_authentication_required');
    assert.doesNotMatch(JSON.stringify([c.body, s.body]), /stack|URIError|createdAt/);
  }
});
