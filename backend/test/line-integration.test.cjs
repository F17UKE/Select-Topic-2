const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app.cjs');
const { HttpError } = require('../src/http.cjs');
const { lineIntegrationConfig } = require('../src/line-config.cjs');
const { createLineIdentityProvider, validateClaims } = require('../src/line-identity-provider.cjs');
const { createLineMessagingService } = require('../src/line-messaging-service.cjs');
const { buildOrderFlexMessage, eventCopy } = require('../src/line-flex-messages.cjs');
const { createLineWebhook, signatureFor } = require('../src/line-webhook.cjs');

const validClaims = (extra = {}) => ({
  iss: 'https://access.line.me', aud: 'channel-123', sub: 'UvalidIdentity123',
  exp: Math.floor(Date.now() / 1000) + 600, ...extra,
});

test('LINE config requires public identifiers and real messaging credentials without exposing them', () => {
  assert.throws(
    () => lineIntegrationConfig({ CUSTOMER_AUTH_MODE: 'line' }),
    /LINE_CHANNEL_ID and LINE_LIFF_ID/,
  );
  assert.throws(
    () => lineIntegrationConfig({ CUSTOMER_AUTH_MODE: 'mock', LINE_MESSAGING_MODE: 'real' }),
    /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN/,
  );
  assert.throws(
    () => lineIntegrationConfig({ NODE_ENV: 'production', CUSTOMER_AUTH_MODE: 'mock', LINE_MESSAGING_MODE: 'mock' }),
    /forbidden in production/,
  );
  const config = lineIntegrationConfig({
    CUSTOMER_AUTH_MODE: 'line', LINE_CHANNEL_ID: 'channel-123', LINE_LIFF_ID: 'liff-123',
    LINE_CHANNEL_SECRET: 'webhook-secret', LINE_MESSAGING_MODE: 'disabled',
  });
  assert.equal(config.webhookSecret, 'webhook-secret');
  assert.equal(config.publicAppUrl, 'https://liff.line.me/liff-123');
});

test('LINE identity verification rejects invalid tokens, issuer, expiry and wrong audience', async () => {
  assert.throws(() => validateClaims(validClaims({ aud: 'wrong' }), 'channel-123'), (error) => {
    assert.equal(error.code, 'line_audience_mismatch'); return true;
  });
  assert.throws(() => validateClaims(validClaims({ iss: 'https://example.test' }), 'channel-123'), HttpError);
  assert.throws(() => validateClaims(validClaims({ exp: 1 }), 'channel-123'), HttpError);

  const invalid = createLineIdentityProvider({ fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(() => invalid.verifyIdToken('x'.repeat(30), 'channel-123'), (error) => {
    assert.equal(error.code, 'invalid_line_token'); return true;
  });
  let submitted;
  const provider = createLineIdentityProvider({ fetchImpl: async (_url, options) => {
    submitted = String(options.body);
    return { ok: true, json: async () => validClaims() };
  } });
  const claims = await provider.verifyIdToken('i'.repeat(30), 'channel-123');
  assert.equal(claims.sub, 'UvalidIdentity123');
  assert.match(submitted, /client_id=channel-123/);
  assert.match(submitted, /id_token=/);
});

test('Flex builders cover every required event and omit payment provider internals', () => {
  const order = {
    id: 42, order_code: 'LOC-000042', store_name: 'Local Kitchen', status: 'READY',
    total_amount: 75, provider_response: { secret: 'must-not-appear' },
  };
  for (const event of Object.keys(eventCopy)) {
    const message = buildOrderFlexMessage(event, order, 'https://liff.line.me/example');
    const serialized = JSON.stringify(message);
    assert.equal(message.type, 'flex');
    assert.match(serialized, /LOC-000042/);
    assert.match(serialized, /Local Kitchen/);
    assert.match(serialized, /ดูสถานะออเดอร์/);
    assert.ok(!serialized.includes('must-not-appear'));
  }
});

test('Messaging provider errors are sanitized and never expose the channel access token', async () => {
  const accessToken = 'SECRET_CHANNEL_ACCESS_TOKEN_VALUE';
  const service = createLineMessagingService({
    config: { messagingMode: 'real', accessToken },
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => accessToken }),
  });
  await assert.rejects(() => service.push('Urecipient', { type: 'text', text: 'test' }), (error) => {
    assert.equal(error.code, 'line_messaging_rejected');
    assert.ok(!JSON.stringify(error).includes(accessToken));
    assert.ok(!error.message.includes(accessToken));
    return true;
  });
});

test('LINE webhook route rejects invalid signatures and safely deduplicates valid delivery', async () => {
  const secret = 'local-webhook-test-secret';
  const handled = [];
  const webhook = createLineWebhook({ secret, onEvent: async (event) => handled.push(event.type) });
  const app = createApp({ checkDatabase: async () => ({ status: 'ok' }), lineWebhook: webhook });
  const payload = JSON.stringify({ events: [
    { type: 'follow', webhookEventId: 'evt-1', source: { type: 'user', userId: 'Uexample' } },
    { type: 'postback', webhookEventId: 'evt-2', postback: { data: 'order=42' } },
  ] });
  await request(app).post('/api/webhooks/line').set('Content-Type', 'application/json')
    .set('x-line-signature', 'invalid').send(payload).expect(401, { error: 'invalid_line_signature', message: 'invalid_line_signature' });
  const signature = signatureFor(secret, Buffer.from(payload));
  const accepted = await request(app).post('/api/webhooks/line').set('Content-Type', 'application/json')
    .set('x-line-signature', signature).send(payload).expect(200);
  assert.deepEqual(accepted.body, { accepted: true, processed: 2, duplicates: 0 });
  const repeated = await request(app).post('/api/webhooks/line').set('Content-Type', 'application/json')
    .set('x-line-signature', signature).send(payload).expect(200);
  assert.deepEqual(repeated.body, { accepted: true, processed: 0, duplicates: 2 });
  assert.deepEqual(handled, ['follow', 'postback']);
});
