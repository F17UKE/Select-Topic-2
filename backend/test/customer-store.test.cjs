const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app.cjs');

function featureApp() {
  const calls = [];
  const profile = { id: 7, line_user_id: 'U_TEST', display_name: 'Mali', phone: '0812345678' };
  const addresses = [
    { id: 11, label: 'Home', dormitory_id: 3, room_number: 'A-1', contact_phone: '0812345678', is_default: true },
    { id: 12, label: 'Campus', dormitory_id: 4, room_number: 'B-2', contact_phone: '0812345678', is_default: false },
  ];
  const auth = {
    config: { mode: 'mock', devLoginEnabled: true },
    authenticate: async () => ({ token: 'test-session', customer: profile }),
    loginDevelopmentCustomer: async () => ({ token: 'test-session', customer: profile }),
    cookie: () => 'customer_session=test-session; HttpOnly; SameSite=Lax; Path=/',
    clearCookie: () => 'customer_session=; Max-Age=0',
    logout: (token) => calls.push(['logout', token]),
  };
  const customers = {
    getProfile: async () => profile,
    updateProfile: async (_id, changes) => ({ ...profile, ...changes }),
    listDormitories: async () => [{ id: 3, name: 'Local Dorm A', soi_name: 'Local Soi 1' }],
    listAddresses: async () => addresses,
    addAddress: async (id, values, makeDefault) => { calls.push(['addAddress', id, values, makeDefault]); return 12; },
    updateAddress: async (id, addressId, values) => calls.push(['updateAddress', id, addressId, values]),
    setDefaultAddress: async (id, addressId) => {
      calls.push(['setDefaultAddress', id, addressId]);
      addresses.forEach((address) => { address.is_default = address.id === addressId; });
    },
  };
  const categories = [{ id: 2, name: 'Noodles', items: [{ id: 9, name: 'Tom Yum Noodles', price: 70 }] }];
  const merchant = { id: 4, store_name: 'Soi Noodle House', gallery: [{ id: 1, image_url: '/demo/noodle.svg' }], categories };
  const stores = {
    listMerchants: async (args) => { calls.push(['listMerchants', args]); return [merchant]; },
    merchantById: async (args) => { calls.push(['merchantById', args]); return merchant; },
    menuForMerchant: async (id) => { calls.push(['menuForMerchant', id]); return categories; },
    menuItemById: async (id) => ({ id, name: 'Tom Yum Noodles', option_groups: [{ name: 'Spiciness', choices: [{ name: 'Hot' }] }] }),
  };
  return { app: createApp({ checkDatabase: async () => ({ status: 'ok' }), auth, customers, stores }), calls };
}

test('dev login sets an HTTP-only session and customer profile can be read and updated', async () => {
  const { app } = featureApp();
  const login = await request(app).post('/api/dev/auth/login').expect(200);
  assert.match(login.headers['set-cookie'][0], /customer_session=test-session; HttpOnly; SameSite=Lax/);
  assert.equal((await request(app).get('/api/customer/profile').expect(200)).body.customer.display_name, 'Mali');
  const updated = await request(app).patch('/api/customer/profile')
    .send({ displayName: 'Mali Updated', phone: '0899999999' }).expect(200);
  assert.equal(updated.body.customer.display_name, 'Mali Updated');
  assert.equal(updated.body.customer.phone, '0899999999');
  await request(app).patch('/api/customer/profile').send({ phone: '1' }).expect(400);
});

test('addresses support list, add, edit and an ownership-scoped default operation', async () => {
  const { app, calls } = featureApp();
  const list = await request(app).get('/api/customer/addresses').expect(200);
  assert.equal(list.body.addresses.length, 2);
  await request(app).post('/api/customer/addresses').send({
    dormitoryId: 3, label: 'Friend', roomNumber: 'F-9', contactPhone: '0812345678',
    addressDetail: 'Call first', isDefault: false,
  }).expect(201);
  await request(app).patch('/api/customer/addresses/12').send({ roomNumber: 'B-3' }).expect(200);
  const changed = await request(app).put('/api/customer/addresses/12/default').expect(200);
  assert.equal(changed.body.addresses.find((address) => address.id === 12).is_default, true);
  assert.deepEqual(calls.find((call) => call[0] === 'setDefaultAddress'), ['setDefaultAddress', 7, 12]);
});

test('merchant listing passes search and address context and detail includes gallery and menu', async () => {
  const { app, calls } = featureApp();
  const list = await request(app).get('/api/merchants?q=noodle&addressId=11').expect(200);
  assert.equal(list.body.merchants[0].store_name, 'Soi Noodle House');
  assert.deepEqual(calls.find((call) => call[0] === 'listMerchants')[1], {
    customerId: 7, addressId: 11, search: 'noodle',
  });
  const detail = await request(app).get('/api/merchants/4?addressId=11').expect(200);
  assert.equal(detail.body.merchant.gallery.length, 1);
  assert.equal(detail.body.merchant.categories[0].items[0].name, 'Tom Yum Noodles');
});

test('menu/category/options routes expose option constraints without ordering behavior', async () => {
  const { app } = featureApp();
  const menu = await request(app).get('/api/merchants/4/menu').expect(200);
  assert.equal(menu.body.categories[0].name, 'Noodles');
  const item = await request(app).get('/api/menu-items/9').expect(200);
  assert.equal(item.body.menu_item.option_groups[0].name, 'Spiciness');
  assert.equal(item.body.menu_item.option_groups[0].choices[0].name, 'Hot');
  await request(app).get('/api/cart').expect(404);
});

test('invalid search and identifier inputs fail before repository access', async () => {
  const { app } = featureApp();
  await request(app).get(`/api/merchants?q=${'x'.repeat(81)}`).expect(400);
  await request(app).get('/api/merchants/nope').expect(400);
  await request(app).get('/api/menu-items/0').expect(400);
});
