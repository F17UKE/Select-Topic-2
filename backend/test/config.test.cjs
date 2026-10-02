const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig, serverConfig, paymentConfig } = require('../src/config.cjs');
const { createSlipStorage } = require('../src/slip-storage.cjs');

// Synthetic test inputs only; these are never used to connect.
const env = { DB_HOST: 'db.example.invalid', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test-only' };
const objectStorage = {
  SLIP_STORAGE_MODE: 'object', SLIP_OBJECT_STORAGE_ENDPOINT: 'https://storage.example.invalid',
  SLIP_OBJECT_STORAGE_REGION: 'ap-southeast-1',
  SLIP_OBJECT_STORAGE_BUCKET: 'test', SLIP_OBJECT_STORAGE_ACCESS_KEY: 'synthetic',
  SLIP_OBJECT_STORAGE_SECRET_KEY: 'synthetic-secret',
  SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
};

test('credentials are environment-only with a bounded pool and timeouts', () => {
  const config = databaseConfig(env);
  assert.equal(config.connection.host, env.DB_HOST);
  assert.equal(config.connection.password, env.DB_PASSWORD);
  assert.equal(config.connection.port, 5432);
  assert.equal(config.connection.ssl, false);
  assert.deepEqual(config.pool, { min: 0, max: 2 });
  assert.equal(config.connection.statement_timeout, 2000);
  assert.equal(config.connection.query_timeout, 2000);
  assert.equal(config.connection.connectionTimeoutMillis, 2000);
  assert.equal(config.acquireConnectionTimeout, 2000);
});

test('unconfigured health is allowed but migrations require credentials', () => {
  assert.equal(databaseConfig({}), null);
  assert.throws(() => databaseConfig({}, { required: true }), /Missing database environment/);
  assert.throws(() => databaseConfig({ DB_HOST: 'partial' }), /DB_NAME, DB_USER, DB_PASSWORD/);
});

test('TLS verifies certificates and does not offer insecure verification bypass', () => {
  assert.deepEqual(databaseConfig({ ...env, DB_SSL_MODE: 'verify-full' }).connection.ssl, { rejectUnauthorized: true });
  assert.throws(() => databaseConfig({ ...env, DB_SSL_MODE: 'require' }), /DB_SSL_MODE/);
  assert.throws(() => databaseConfig({ ...env, DB_SSL_CA_FILE: '/unused' }), /requires verify-full/);
});

test('invalid numeric configuration fails rather than silently truncating/defaulting', () => {
  for (const [name, value] of [['DB_PORT', '5432oops'], ['DB_PORT', '65536'], ['DB_POOL_MAX', '0'],
    ['DB_POOL_MAX', '6'], ['DB_CONNECT_TIMEOUT_MS', '-1'], ['DB_QUERY_TIMEOUT_MS', 'NaN']]) {
    assert.throws(() => databaseConfig({ ...env, [name]: value }), new RegExp(name));
  }
  assert.throws(() => serverConfig({ PORT: '3001abc' }), /PORT/);
  assert.deepEqual(serverConfig({}), { host: '127.0.0.1', port: 3001 });
});

test('mock payment verification is local-only and upload limits are bounded', () => {
  assert.equal(paymentConfig({ NODE_ENV: 'development', PAYMENT_VERIFICATION_MODE: 'mock' }).verificationMode, 'mock');
  const production = paymentConfig({
    NODE_ENV: 'production', CHECKSLIP_API_URL: 'https://provider.example.invalid/branch/test',
    CHECKSLIP_API_KEY: 'synthetic-test-key', ...objectStorage,
  });
  assert.equal(production.verificationMode, 'checkslip');
  assert.equal(production.checkslipApiUrl.href, 'https://provider.example.invalid/branch/test');
  assert.equal(production.checkslipConnectTimeoutMs, 3000);
  assert.equal(production.checkslipRequestTimeoutMs, 10000);
  assert.equal(production.storageMode, 'object');
  assert.equal(production.objectStorageRegion, 'ap-southeast-1');
  assert.equal(production.objectStorageForcePathStyle, true);
  assert.throws(
    () => paymentConfig({ NODE_ENV: 'production', PAYMENT_VERIFICATION_MODE: 'mock' }),
    /forbidden in production/,
  );
  assert.throws(() => paymentConfig({ NODE_ENV: 'production' }), /CHECKSLIP_API_URL, CHECKSLIP_API_KEY/);
  assert.throws(() => paymentConfig({
    NODE_ENV: 'production', CHECKSLIP_API_URL: 'http://provider.example.invalid/test', CHECKSLIP_API_KEY: 'test',
    ...objectStorage,
  }), /HTTPS/);
  assert.throws(() => paymentConfig({
    PAYMENT_VERIFICATION_MODE: 'checkslip', CHECKSLIP_API_URL: 'not-a-url', CHECKSLIP_API_KEY: 'test',
  }), /absolute HTTP/);
  assert.throws(() => paymentConfig({ SLIP_MAX_BYTES: String(11 * 1024 * 1024) }), /SLIP_MAX_BYTES/);
  assert.throws(() => paymentConfig({ PAYMENT_VERIFICATION_MODE: 'mock', SLIP_STORAGE_MODE: 'object' }), /SLIP_OBJECT_STORAGE_ENDPOINT/);
  assert.throws(() => paymentConfig({
    PAYMENT_VERIFICATION_MODE: 'mock', ...objectStorage, SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE: 'sometimes',
  }), /SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE/);
  assert.throws(() => paymentConfig({
    NODE_ENV: 'production', CHECKSLIP_API_URL: 'https://provider.example.invalid/test', CHECKSLIP_API_KEY: 'test',
    ...objectStorage, SLIP_OBJECT_STORAGE_ENDPOINT: 'http://storage.example.invalid',
  }), /HTTPS/);
  assert.throws(() => paymentConfig({
    PAYMENT_VERIFICATION_MODE: 'mock', ...objectStorage, SLIP_OBJECT_STORAGE_CA_FILE: 'missing-ca.pem',
  }), /readable, valid CA/);
  assert.equal(createSlipStorage(production, { client: { send: async () => ({}) } }).productionReady, true);
});

test('object storage config errors never include credential values', () => {
  let message = '';
  try {
    paymentConfig({
      PAYMENT_VERIFICATION_MODE: 'mock',
      ...objectStorage,
      SLIP_OBJECT_STORAGE_ENDPOINT: 'not-a-url',
    });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /SLIP_OBJECT_STORAGE_ENDPOINT/);
  assert.doesNotMatch(message, /synthetic-secret|synthetic/);
});
