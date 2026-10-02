const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app.cjs');
const { createDatabaseProbe } = require('../src/database.cjs');

test('health checks PostgreSQL with SELECT 1 and returns API/database readiness', async () => {
  let queries = 0;
  const db = { raw: async (sql) => { assert.equal(sql, 'SELECT 1 AS ok'); queries++; } };
  const app = createApp({ checkDatabase: createDatabaseProbe(db) });
  const response = await request(app).get('/api/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok', api: { status: 'ok' }, database: { status: 'ok' } });
  assert.equal(queries, 1);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('DB errors return 503 without exposing connection details and recover on retry', async () => {
  let fail = true;
  const db = { raw: async () => { if (fail) throw new Error('sensitive-provider-details'); } };
  const app = createApp({ checkDatabase: createDatabaseProbe(db) });
  const response = await request(app).get('/api/health').expect(503);
  assert.deepEqual(response.body, { status: 'degraded', api: { status: 'ok' }, database: { status: 'unavailable' } });
  assert.ok(!response.text.includes('sensitive-provider-details'));
  fail = false;
  await request(app).get('/api/health').expect(200);
});

test('missing configuration reports not_configured, not a false positive', async () => {
  const app = createApp({ checkDatabase: createDatabaseProbe(null) });
  const response = await request(app).get('/api/health').expect(503);
  assert.equal(response.body.database.status, 'not_configured');
});

test('unexpected probe exceptions also return sanitized JSON', async () => {
  const app = createApp({ checkDatabase: async () => { throw new Error('private detail'); } });
  const response = await request(app).get('/api/health').expect(503);
  assert.equal(response.body.database.status, 'unavailable');
  assert.ok(!response.text.includes('private detail'));
});

test('concurrent probes share one in-flight connection attempt', async () => {
  let release;
  let calls = 0;
  const probe = createDatabaseProbe({ raw: () => {
    calls++;
    return new Promise((resolve) => { release = resolve; });
  } });
  const responses = Array.from({ length: 20 }, () => probe());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  for (const result of await Promise.all(responses)) assert.equal(result.status, 'ok');
});

test('unconfigured LINE webhook returns 501 and unknown API routes are 404', async () => {
  const app = createApp({ checkDatabase: createDatabaseProbe(null) });
  await request(app).post('/webhooks/line').send({ events: [] }).expect(501, { error: 'line_webhook_not_implemented' });
  await request(app).get('/api/orders').expect(404, { error: 'not_found' });
});
