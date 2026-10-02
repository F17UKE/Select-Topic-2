const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('frontend has no DB client or public backend origin', () => {
  const manifest = JSON.parse(read('frontend/package.json'));
  for (const dep of ['pg', 'knex', 'dotenv']) assert.equal(manifest.dependencies[dep], undefined);
  const client = [
    read('frontend/app/page.js'),
    read('frontend/lib/api.js'),
    read('frontend/lib/use-customer.js'),
  ].join('\n');
  assert.match(client, /['"`]\/api\//);
  assert.doesNotMatch(client, /10\.0\.7\.6|DB_PASSWORD|NEXT_PUBLIC_.*(API|DATABASE)/);
});

test('production LINE customer UI is gated outside LIFF while local mock remains available', async () => {
  const { resolveCustomerBrowserAccess } = await import('../frontend/lib/customer-access-policy.mjs');
  assert.equal(resolveCustomerBrowserAccess({ pathname: '/', authMode: 'line', isInClient: false }), 'line_client_required');
  assert.equal(resolveCustomerBrowserAccess({ pathname: '/orders/1', authMode: 'line', isInClient: true }), 'allowed');
  assert.equal(resolveCustomerBrowserAccess({ pathname: '/', authMode: 'mock', isInClient: false }), 'allowed');
  const gate = read('frontend/components/customer-access-gate.js');
  assert.match(gate, /isInLiffClient/);
  assert.match(gate, /กรุณาเปิดผ่าน LINE/);
});

test('merchant and rider browser paths bypass only the customer LIFF UX gate', async () => {
  const { resolveCustomerBrowserAccess } = await import('../frontend/lib/customer-access-policy.mjs');
  for (const pathname of ['/merchant', '/merchant/orders/1', '/rider', '/rider/orders/1']) {
    assert.equal(resolveCustomerBrowserAccess({ pathname, authMode: 'line', isInClient: false }), 'allowed');
  }
  const layout = read('frontend/app/layout.js');
  assert.match(layout, /CustomerAccessGate/);
});

test('production Next routing leaves API proxying to Nginx', async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const config = (await import('../frontend/next.config.mjs')).default;
    assert.deepEqual(await config.rewrites(), []);
    process.env.NODE_ENV = 'development';
    assert.equal((await config.rewrites())[0].destination, 'http://127.0.0.1:3001/api/:path*');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('Nginx preserves API and webhook paths and uses private upstreams', () => {
  const nginx = read('deploy/nginx/select-topic-2.conf');
  assert.match(nginx, /location \^~ \/api\/\s*\{[^}]*proxy_pass http:\/\/10\.0\.7\.6:3001;/);
  assert.match(nginx, /location = \/webhooks\/line\s*\{[^}]*proxy_pass http:\/\/10\.0\.7\.6:3001;/);
  assert.match(nginx, /location \/\s*\{[^}]*proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(nginx, /client_max_body_size 11m;/);
});

test('PM2 can parse both ecosystem files and resolve each entry point', () => {
  const common = require('pm2/lib/Common');
  for (const service of ['frontend', 'backend']) {
    const filename = path.join(root, `deploy/pm2/${service}.ecosystem.config.cjs`);
    assert.equal(common.isConfigFile(filename), 'js');
    const { apps } = common.parseConfig(fs.readFileSync(filename), filename);
    assert.equal(apps.length, 1);
    assert.equal(apps[0].instances, 1);
    assert.equal(apps[0].exec_mode, 'fork');
    assert.ok(fs.existsSync(apps[0].script));
    assert.ok(fs.existsSync(apps[0].cwd));
    assert.equal(apps[0].env.DB_PASSWORD, undefined);
  }
});

test('production deployment examples fail safe and preflight every backend config domain', () => {
  const example = read('backend/.env.example');
  assert.match(example, /^HOST=10\.0\.7\.6$/m);
  assert.match(example, /^PORT=3001$/m);
  assert.match(example, /^NODE_ENV=production$/m);
  assert.match(example, /^DB_SSL_MODE=verify-full$/m);
  for (const name of ['SLIP_OBJECT_STORAGE_ENDPOINT', 'SLIP_OBJECT_STORAGE_REGION',
    'SLIP_OBJECT_STORAGE_BUCKET', 'SLIP_OBJECT_STORAGE_ACCESS_KEY',
    'SLIP_OBJECT_STORAGE_SECRET_KEY', 'SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE',
    'SLIP_OBJECT_STORAGE_CA_FILE']) {
    assert.match(example, new RegExp(`^${name}=`, 'm'));
  }
  assert.doesNotMatch(example, /^(?:DB_PASSWORD|LINE_CHANNEL_SECRET|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|CHECKSLIP_API_KEY|SLIP_OBJECT_STORAGE_SECRET_KEY)=.+$/m);

  const deploy = read('deploy/scripts/deploy-backend.sh');
  for (const factory of ['databaseConfig', 'serverConfig', 'paymentConfig', 'customerAuthConfig',
    'merchantStaffAuthConfig', 'lineIntegrationConfig', 'securityConfig']) {
    assert.match(deploy, new RegExp(`\\b${factory}\\b`));
  }
  assert.match(deploy, /createSlipStorage\(paymentConfig\(\)\)/);
  assert.doesNotMatch(deploy, /production adapter is not implemented/);
});
