const { test } = require('node:test');
const assert = require('node:assert/strict');
const { customerAuthConfig } = require('../src/auth.cjs');

test('production always rejects mock auth and the dev login switch', () => {
  assert.throws(
    () => customerAuthConfig({ NODE_ENV: 'production', CUSTOMER_AUTH_MODE: 'mock', ENABLE_DEV_LOGIN: 'false' }),
    /forbidden in production/,
  );
  assert.throws(
    () => customerAuthConfig({ NODE_ENV: 'production', CUSTOMER_AUTH_MODE: 'line', ENABLE_DEV_LOGIN: 'true' }),
    /forbidden in production/,
  );
  assert.deepEqual(customerAuthConfig({ NODE_ENV: 'production' }), {
    mode: 'line', devLoginEnabled: false, devLineUserId: 'U_LOCAL_CUSTOMER_001', secureCookie: true,
    lineChannelId: '', liffId: '',
  });
});

test('development mock login is explicit, switchable, and validates combinations', () => {
  assert.equal(customerAuthConfig({ NODE_ENV: 'development', CUSTOMER_AUTH_MODE: 'mock' }).devLoginEnabled, false);
  assert.equal(customerAuthConfig({
    NODE_ENV: 'development', CUSTOMER_AUTH_MODE: 'mock', ENABLE_DEV_LOGIN: 'true',
  }).devLoginEnabled, true);
  assert.throws(
    () => customerAuthConfig({ NODE_ENV: 'development', CUSTOMER_AUTH_MODE: 'line', ENABLE_DEV_LOGIN: 'true' }),
    /requires CUSTOMER_AUTH_MODE=mock/,
  );
  assert.throws(() => customerAuthConfig({ ENABLE_DEV_LOGIN: 'yes' }), /must be true or false/);
});
