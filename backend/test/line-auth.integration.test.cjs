const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
require('../src/env.cjs');
const { createApp } = require('../src/app.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createCustomerAuth } = require('../src/auth.cjs');
const { createCustomerRepository } = require('../src/customer-repository.cjs');
const { createStoreRepository } = require('../src/store-repository.cjs');
const { HttpError } = require('../src/http.cjs');

const localDatabase = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
  && process.env.DB_NAME === 'select_topic_2_local';

function claims(sub = 'U_LOCAL_CUSTOMER_001', extra = {}) {
  return { iss: 'https://access.line.me', aud: 'channel-local', sub, exp: Math.floor(Date.now() / 1000) + 600, ...extra };
}

function appFor(db, identityProvider) {
  return createApp({
    checkDatabase: createDatabaseProbe(db),
    auth: createCustomerAuth({
      db,
      config: {
        mode: 'line', devLoginEnabled: false, devLineUserId: '', secureCookie: false,
        lineChannelId: 'channel-local', liffId: 'liff-local',
      },
      identityProvider,
    }),
    customers: createCustomerRepository(db),
    stores: createStoreRepository(db),
  });
}

test('LINE auth validates identity, ignores spoofed user IDs and establishes a server session', {
  skip: !localDatabase && 'requires select_topic_2_local on loopback',
}, async (t) => {
  const db = createDatabase(process.env, { required: true });
  const createdLineUserId = 'UlineIntegrationNewCustomer';
  try {
    await t.test('invalid provider token is rejected', async () => {
      const app = appFor(db, { verifyIdToken: async () => { throw new HttpError(401, 'invalid_line_token'); } });
      await request(app).post('/api/auth/line').send({ idToken: 'bad', line_user_id: 'U_LOCAL_CUSTOMER_001' })
        .expect(401, { error: 'invalid_line_token', message: 'invalid_line_token' });
    });

    await t.test('wrong audience is rejected even when an injected provider returns claims', async () => {
      const app = appFor(db, { verifyIdToken: async () => claims('U_LOCAL_CUSTOMER_001', { aud: 'wrong-channel' }) });
      const response = await request(app).post('/api/auth/line').send({ idToken: 'x'.repeat(30) }).expect(401);
      assert.equal(response.body.error, 'line_audience_mismatch');
    });

    await t.test('frontend supplied line_user_id has no effect', async () => {
      const app = appFor(db, { verifyIdToken: async () => claims('U_LOCAL_CUSTOMER_001') });
      const agent = request.agent(app);
      await agent.get('/api/customer/profile').expect(401, {
        error: 'authentication_required', message: 'authentication_required',
      });
      const login = await agent.post('/api/auth/line').send({
        idToken: 'x'.repeat(30), line_user_id: 'UspoofedIdentity', userId: 'UanotherSpoof',
      }).expect(200);
      assert.equal(login.body.customer.line_user_id, 'U_LOCAL_CUSTOMER_001');
      assert.equal(login.body.onboarding_required, false);
      const me = await agent.get('/api/auth/me').expect(200);
      assert.equal(me.body.customer.line_user_id, 'U_LOCAL_CUSTOMER_001');
      const profile = await agent.get('/api/customer/profile').expect(200);
      assert.equal(profile.body.customer.line_user_id, 'U_LOCAL_CUSTOMER_001');
    });

    await t.test('new verified LINE identity creates an onboarding customer', async () => {
      await db('customers').where({ line_user_id: createdLineUserId }).delete();
      const app = appFor(db, { verifyIdToken: async () => claims(createdLineUserId, { name: 'LINE New User', picture: 'https://example.test/profile.png' }) });
      const response = await request(app).post('/api/auth/line').send({ idToken: 'x'.repeat(30) }).expect(200);
      assert.equal(response.body.customer.line_user_id, createdLineUserId);
      assert.equal(response.body.customer.display_name, 'LINE New User');
      assert.equal(response.body.onboarding_required, true);
    });
  } finally {
    await db('customers').where({ line_user_id: createdLineUserId }).delete();
    await db.destroy();
  }
});
