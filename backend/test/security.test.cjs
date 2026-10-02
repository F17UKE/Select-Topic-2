const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app.cjs');
const { securityConfig } = require('../src/security-config.cjs');

test('production security config validates origin and trusted proxy depth', () => {
  assert.throws(() => securityConfig({ NODE_ENV: 'production' }), /APP_PUBLIC_URL/);
  assert.throws(() => securityConfig({ NODE_ENV: 'production', APP_PUBLIC_URL: 'invalid' }), /absolute URL/);
  assert.throws(() => securityConfig({ APP_PUBLIC_URL: 'https://app.example', TRUST_PROXY_HOPS: '4' }), /0 and 3/);
  assert.deepEqual(securityConfig({
    NODE_ENV: 'production', APP_PUBLIC_URL: 'https://app.example/path', TRUST_PROXY_HOPS: '1',
  }), { production: true, allowedOrigin: 'https://app.example', trustProxyHops: 1 });
});

test('API sends security headers and rejects cross-origin browser requests', async () => {
  const app = createApp({
    checkDatabase: async () => ({ status: 'ok' }),
    security: { production: true, allowedOrigin: 'https://app.example', trustProxyHops: 1 },
  });
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal(health.headers['x-frame-options'], 'DENY');
  assert.match(health.headers['content-security-policy'], /default-src 'none'/);
  await request(app).get('/api/health').set('Origin', 'https://evil.example').expect(403, { error: 'origin_not_allowed' });
  await request(app).get('/api/health').set('Origin', 'https://app.example').expect(200);
});
