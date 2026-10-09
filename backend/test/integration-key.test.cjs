const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const request = require('supertest');
const { resolveIntegrationKey } = require('../src/integration-key.cjs');
const { createIntegrationCrypto } = require('../src/integration-crypto.cjs');
const { createIntegrationSettings } = require('../src/integration-settings.cjs');
const { createApp } = require('../src/app.cjs');
const root = path.resolve(__dirname, '../..');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'food-integration-key-'));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('food-integration-key-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { NODE_ENV: 'development', INTEGRATION_SETTINGS_KEY_FILE: path.join(directory, 'runtime', 'settings.key') };
}

test('first development boot persists a private random key, reused without rewriting', (t) => {
  const env = fixture(t);
  const first = resolveIntegrationKey(env);
  assert.equal(first.source, 'DEVELOPMENT_FILE');
  assert.equal(Buffer.from(first.encoded, 'base64').length, 32);
  const stat = fs.statSync(env.INTEGRATION_SETTINGS_KEY_FILE);
  assert.ok(resolveIntegrationKey(env).encoded === first.encoded);
  assert.equal(fs.statSync(env.INTEGRATION_SETTINGS_KEY_FILE).mtimeMs, stat.mtimeMs);
  assert.equal(fs.readdirSync(path.dirname(env.INTEGRATION_SETTINGS_KEY_FILE)).length, 1);
  if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
  else {
    const acl = spawnSync('icacls.exe', [env.INTEGRATION_SETTINGS_KEY_FILE], { encoding: 'utf8', windowsHide: true });
    assert.equal(acl.status, 0); assert.doesNotMatch(acl.stdout, /\(I\)|Everyone|BUILTIN\\Users/);
  }
});

test('a new backend process decrypts existing ciphertext, with no key or secret logged', (t) => {
  const env = fixture(t);
  const first = resolveIntegrationKey(env);
  const envelope = createIntegrationCrypto(first.encoded).encrypt('EASYSLIP_API_KEY', 'synthetic-restart-secret');
  const child = spawnSync(process.execPath, ['-e', `
    const {resolveIntegrationKey}=require('./backend/src/integration-key.cjs');
    const {createIntegrationCrypto}=require('./backend/src/integration-crypto.cjs');
    const c=createIntegrationCrypto(resolveIntegrationKey(JSON.parse(process.argv[1])).encoded);
    if(c.decrypt('EASYSLIP_API_KEY',process.argv[2])!=='synthetic-restart-secret')process.exitCode=1;
  `, JSON.stringify(env), envelope], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
});

test('concurrent first boots publish one complete key without overwriting', async (t) => {
  const env = fixture(t);
  const script = `const k=require('./backend/src/integration-key.cjs').resolveIntegrationKey(JSON.parse(process.argv[1]));process.stdout.write(require('node:crypto').createHash('sha256').update(k.encoded).digest('hex'));`;
  const results = await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ['-e', script, JSON.stringify(env)], { cwd: root, windowsHide: true })));
  assert.ok(results.every((r) => r.stdout === results[0].stdout && r.stderr === ''));
  assert.equal(fs.readdirSync(path.dirname(env.INTEGRATION_SETTINGS_KEY_FILE)).length, 1);
});

test('ENV key overrides the file without replacing it, preserving old encrypted settings', (t) => {
  const env = fixture(t);
  const generated = resolveIntegrationKey(env).encoded;
  const override = crypto.randomBytes(32).toString('base64');
  const original = createIntegrationCrypto(override).encrypt('LINE_WEBHOOK_SECRET', 'synthetic-old-secret');
  const resolved = resolveIntegrationKey({ ...env, INTEGRATION_SETTINGS_ENCRYPTION_KEY: override });
  assert.equal(resolved.source, 'ENVIRONMENT');
  assert.equal(createIntegrationCrypto(resolved.encoded).decrypt('LINE_WEBHOOK_SECRET', original), 'synthetic-old-secret');
  assert.ok(resolveIntegrationKey(env).encoded === generated);
  assert.throws(() => resolveIntegrationKey({ ...env, INTEGRATION_SETTINGS_ENCRYPTION_KEY: 'invalid-sensitive-value' }), /Invalid integration encryption key/);
});

test('production never creates a key; a provisioned persistent file works', (t) => {
  const env = fixture(t);
  assert.equal(resolveIntegrationKey({ NODE_ENV: 'production' }).source, 'UNAVAILABLE');
  assert.throws(() => resolveIntegrationKey({ ...env, NODE_ENV: 'production' }), /key file/);
  assert.equal(fs.existsSync(env.INTEGRATION_SETTINGS_KEY_FILE), false);
  const local = resolveIntegrationKey(env);
  const production = resolveIntegrationKey({ ...env, NODE_ENV: 'production' });
  assert.equal(production.source, 'PERSISTENT_FILE');
  assert.ok(production.encoded === local.encoded);
  assert.equal(resolveIntegrationKey({ NODE_ENV: 'test' }).source, 'UNAVAILABLE');
  assert.equal(resolveIntegrationKey({ NODE_ENV: 'staging' }).source, 'UNAVAILABLE');
});

test('corrupt existing key fails closed without regeneration or sensitive error output', (t) => {
  const env = fixture(t);
  resolveIntegrationKey(env);
  fs.writeFileSync(env.INTEGRATION_SETTINGS_KEY_FILE, 'sensitive-corrupt-key');
  assert.throws(() => resolveIntegrationKey(env), (error) => {
    assert.doesNotMatch(error.message, /sensitive-corrupt-key/); return /key file/.test(error.message);
  });
  assert.equal(fs.readFileSync(env.INTEGRATION_SETTINGS_KEY_FILE, 'utf8'), 'sensitive-corrupt-key');
  assert.throws(() => resolveIntegrationKey({ NODE_ENV: 'production', INTEGRATION_SETTINGS_KEY_FILE: './relative.key' }), /absolute path/);
});

test('recreated integration service reads ciphertext and API never returns encryption key or path', async (t) => {
  const env = fixture(t);
  const key = resolveIntegrationKey(env).encoded;
  const row = { version: 1, normal_values: {}, secret_values: {
    EASYSLIP_API_KEY: createIntegrationCrypto(key).encrypt('EASYSLIP_API_KEY', 'synthetic-stored-secret'),
  } };
  const db = (table) => table === 'merchants'
    ? { whereNull: () => ({ select: async () => [] }) }
    : { where: () => ({ first: async () => row }) };
  for (let i = 0; i < 2; i++) {
    const integrations = createIntegrationSettings({ db, env });
    assert.equal((await integrations.environment()).EASYSLIP_API_KEY, 'synthetic-stored-secret');
    const app = createApp({ integrations, admins: {}, adminAuth: {
      authenticate: async () => ({ admin: { id: 1, role: 'SUPER_ADMIN' } }), requirePermission: () => {},
    }, checkDatabase: async () => ({ status: 'ok' }) });
    const response = await request(app).get('/api/admin/settings/integrations').expect(200);
    assert.equal(response.body.encryption_ready, true);
    assert.equal(response.body.encryption_key_source, 'DEVELOPMENT_FILE');
    assert.ok(!response.text.includes(key));
    assert.ok(!response.text.includes(env.INTEGRATION_SETTINGS_KEY_FILE));
    assert.doesNotMatch(response.text, /synthetic-stored-secret|secret_values|INTEGRATION_SETTINGS_KEY_FILE/);
  }
});

test('default runtime key and temporary publication files are ignored by Git', () => {
  const result = spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, encoding: 'utf8', input: 'backend/.runtime/integration-settings.key\nbackend/.runtime/integration-settings.key.random.tmp\n', windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim().split('\n').length, 2);
});
