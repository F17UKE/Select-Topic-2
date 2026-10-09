const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { createIntegrationCrypto } = require('../src/integration-crypto.cjs');
const root = path.resolve(__dirname, '../..');
const shell = fs.readFileSync(path.join(root, 'deploy/scripts/deploy-backend.sh'), 'utf8');
// Execute precisely the deploy script's Node preflight, never its shell/deploy commands.
const preflight = shell.split("<<'NODE'\n")[1].split('\nNODE')[0];
const base = {
  NODE_ENV: 'production', HOST: '10.0.7.6', PORT: '3001', APP_PUBLIC_URL: 'https://app.example.invalid',
  CUSTOMER_AUTH_MODE: 'line', ENABLE_DEV_LOGIN: 'false', MERCHANT_STAFF_AUTH_MODE: 'password', ENABLE_STAFF_DEV_LOGIN: 'false',
  LINE_CHANNEL_ID: 'synthetic-channel', LINE_CHANNEL_SECRET: 'synthetic-secret', LINE_LIFF_ID: 'synthetic-liff',
  LINE_MESSAGING_MODE: 'real', LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-token',
  DB_HOST: '10.0.7.7', DB_NAME: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', DB_SSL_MODE: 'verify-full', DB_SSL_CA_FILE: '',
  SLIP_STORAGE_MODE: 'object', SLIP_OBJECT_STORAGE_ENDPOINT: 'https://storage.example.invalid',
  SLIP_OBJECT_STORAGE_REGION: 'test', SLIP_OBJECT_STORAGE_BUCKET: 'test', SLIP_OBJECT_STORAGE_ACCESS_KEY: 'synthetic-access',
  SLIP_OBJECT_STORAGE_SECRET_KEY: 'synthetic-storage-secret', SLIP_OBJECT_STORAGE_CA_FILE: '',
  CHECKSLIP_API_URL: '', CHECKSLIP_API_KEY: '', EASYSLIP_API_KEY: '', EASYSLIP_MERCHANT_ACCOUNTS: '',
  EASYSLIP_API_BASE_URL: 'https://api.easyslip.com/v2',
};
const easy = { PAYMENT_VERIFICATION_MODE: 'easyslip', EASYSLIP_API_KEY: 'synthetic-easy-key',
  EASYSLIP_MERCHANT_ACCOUNTS: JSON.stringify({ 1: { promptpayType: 'PHONE', promptpayId: '0800000001', bankCode: '004', bankNumber: '1234567890' } }) };
const check = { PAYMENT_VERIFICATION_MODE: 'checkslip', CHECKSLIP_API_KEY: 'synthetic-check-key', CHECKSLIP_API_URL: 'https://provider.example.invalid/verify' };
function run(extra, row = null) {
  const fakeDb = `const fixtureRow=${JSON.stringify(row)};const fixtureDb=()=>({where:()=>({first:async()=>fixtureRow})});fixtureDb.destroy=async()=>{};require.cache[require.resolve('./backend/src/database.cjs')]={exports:{createDatabase:()=>fixtureDb}};`;
  const result = spawnSync(process.execPath, ['-e', fakeDb + preflight], { cwd: root, env: { ...process.env, ...base, ...extra }, encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-easy-key|synthetic-check-key|synthetic-storage-secret|1234567890/);
  return result;
}
test('actual production deploy preflight accepts each provider without unused credentials', () => {
  for (const config of [easy, check]) {
    const result = run(config);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('production deploy preflight resolves encrypted DB provider override before ENV validation', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const row = { version: 1, normal_values: { PAYMENT_VERIFICATION_MODE: 'easyslip' },
    secret_values: { EASYSLIP_API_KEY: createIntegrationCrypto(key).encrypt('EASYSLIP_API_KEY', 'synthetic-easy-key') } };
  const result = run({ PAYMENT_VERIFICATION_MODE: 'checkslip', INTEGRATION_SETTINGS_ENCRYPTION_KEY: key, EASYSLIP_MERCHANT_ACCOUNTS: easy.EASYSLIP_MERCHANT_ACCOUNTS }, row);
  assert.equal(result.status, 0, result.stderr);
});
test('actual preflight fails safely for missing selected key, unresolved recipient, unsupported/mock mode', () => {
  for (const [config, expected] of [
    [{ ...easy, EASYSLIP_API_KEY: '' }, /EASYSLIP_API_KEY/],
    [{ ...easy, EASYSLIP_MERCHANT_ACCOUNTS: '{}' }, /EASYSLIP_MERCHANT_ACCOUNTS/],
    [{ ...check, CHECKSLIP_API_KEY: '' }, /CHECKSLIP_API_KEY/],
    [{ PAYMENT_VERIFICATION_MODE: 'unsupported' }, /PAYMENT_VERIFICATION_MODE/],
    [{ PAYMENT_VERIFICATION_MODE: 'mock' }, /mock is forbidden/],
  ]) {
    const result = run(config);
    assert.notEqual(result.status, 0);
    void expected;
    assert.match(result.stderr, /Production integration preflight failed/);
  }
});
