const { test } = require('node:test');
const assert = require('node:assert/strict');
const { merchantStaffAuthConfig } = require('../src/staff-auth.cjs');

test('production rejects mock merchant staff auth and the dev login switch', () => {
  assert.throws(
    () => merchantStaffAuthConfig({ NODE_ENV: 'production', MERCHANT_STAFF_AUTH_MODE: 'mock' }),
    /forbidden in production/,
  );
  assert.throws(
    () => merchantStaffAuthConfig({ NODE_ENV: 'production', MERCHANT_STAFF_AUTH_MODE: 'password', ENABLE_STAFF_DEV_LOGIN: 'true' }),
    /forbidden in production/,
  );
  assert.deepEqual(merchantStaffAuthConfig({ NODE_ENV: 'production' }), {
    mode: 'password', devLoginEnabled: false, defaultUsername: 'local_manager', secureCookie: true,
  });
});

test('development staff mock login is explicit and validates configuration', () => {
  assert.equal(merchantStaffAuthConfig({ NODE_ENV: 'development' }).mode, 'mock');
  assert.equal(merchantStaffAuthConfig({
    NODE_ENV: 'development', MERCHANT_STAFF_AUTH_MODE: 'mock', ENABLE_STAFF_DEV_LOGIN: 'true',
  }).devLoginEnabled, true);
  assert.throws(
    () => merchantStaffAuthConfig({ MERCHANT_STAFF_AUTH_MODE: 'password', ENABLE_STAFF_DEV_LOGIN: 'true' }),
    /requires MERCHANT_STAFF_AUTH_MODE=mock/,
  );
  assert.throws(() => merchantStaffAuthConfig({ ENABLE_STAFF_DEV_LOGIN: 'yes' }), /must be true or false/);
});
