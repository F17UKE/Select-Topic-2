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

test('merchant, rider and admin browser paths bypass only the customer LIFF UX gate', async () => {
  const { resolveCustomerBrowserAccess } = await import('../frontend/lib/customer-access-policy.mjs');
  for (const pathname of ['/merchant', '/merchant/orders/1', '/rider', '/rider/orders/1', '/admin', '/admin/login', '/admin/orders/1']) {
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
    const headers = (await config.headers())[0].headers;
    for (const name of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      assert.ok(headers.some((header) => header.key === name));
    }
    process.env.NODE_ENV = 'development';
    const rewrites = await config.rewrites();
    assert.equal(rewrites[0].destination, 'http://127.0.0.1:3001/api/:path*');
    assert.equal(rewrites[1].destination, 'http://127.0.0.1:3001/webhooks/line');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('Nginx preserves API and webhook paths and uses private upstreams', () => {
  const nginx = read('deploy/nginx/select-topic-2.conf');
  assert.match(nginx, /location \^~ \/api\/\s*\{[^}]*proxy_pass http:\/\/10\.0\.7\.6:3001;/);
  assert.match(nginx, /location = \/api\/webhooks\/line\s*\{[^}]*proxy_pass http:\/\/10\.0\.7\.6:3001;/);
  assert.match(nginx, /location = \/webhooks\/line\s*\{[^}]*proxy_pass http:\/\/10\.0\.7\.6:3001;/);
  assert.match(nginx, /location \/\s*\{[^}]*proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(nginx, /client_max_body_size 11m;/);
  for (const name of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.match(nginx, new RegExp(`add_header ${name.replaceAll('-', '\\-')}`));
  }
});

test('systemd runs one hardened process per host with external environment files', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.dependencies?.pm2, undefined);
  for (const service of ['frontend', 'backend']) {
    const unit = read(`deploy/systemd/select-topic-2-${service}.service`);
    assert.match(unit, /^User=select-topic-2$/m);
    assert.match(unit, new RegExp(`^EnvironmentFile=/etc/select-topic-2/${service}\\.env$`, 'm'));
    assert.match(unit, /^ExecStart=\/usr\/bin\/env node \/opt\/select-topic-2\//m);
    assert.doesNotMatch(unit, /^ExecStart=.*(?:npm|npx|sh|bash)\b/m);
    assert.match(unit, /^Restart=on-failure$/m);
    assert.match(unit, /^WantedBy=multi-user\.target$/m);
    assert.match(unit, /^ProtectSystem=strict$/m);
    assert.doesNotMatch(unit, /PASSWORD|SECRET|TOKEN|pm2/i);
  }
  assert.equal(fs.existsSync(path.join(root, 'deploy/pm2')), false);
  assert.match(read('deploy/scripts/deploy-frontend.sh'), /npm prune --omit=dev --workspace frontend/);
});

test('HTTPS template redirects HTTP, enables HSTS only on TLS and preserves proxy paths', () => {
  const nginx = read('deploy/nginx/select-topic-2-https.conf.template');
  assert.match(nginx, /return 308 https:\/\/__PRODUCTION_DOMAIN__\$request_uri;/);
  assert.match(nginx, /listen 443 ssl http2;/);
  assert.match(nginx, /listen \[::\]:443 ssl http2;/);
  assert.doesNotMatch(nginx, /^\s*http2 on;/m);
  assert.match(nginx, /Strict-Transport-Security/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto https;/);
  for (const route of ['/api/webhooks/line', '/webhooks/line']) {
    assert.match(nginx, new RegExp(`location = ${route.replaceAll('/', '\\/')}\\s*\\{[^}]*10\\.0\\.7\\.6:3001`));
  }
  assert.match(nginx, /location \/\s*\{[^}]*127\.0\.0\.1:3000/);
});

test('production deployment examples fail safe and preflight every backend config domain', () => {
  const example = read('backend/.env.example');
  assert.match(example, /^HOST=10\.0\.7\.6$/m);
  assert.match(example, /^PORT=3001$/m);
  assert.match(example, /^NODE_ENV=production$/m);
  assert.match(example, /^DB_SSL_MODE=verify-full$/m);
  assert.match(example, /^DB_HOST=10\.0\.7\.7$/m);
  for (const name of ['SLIP_OBJECT_STORAGE_ENDPOINT', 'SLIP_OBJECT_STORAGE_REGION',
    'SLIP_OBJECT_STORAGE_BUCKET', 'SLIP_OBJECT_STORAGE_ACCESS_KEY',
    'SLIP_OBJECT_STORAGE_SECRET_KEY', 'SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE',
    'SLIP_OBJECT_STORAGE_CA_FILE']) {
    assert.match(example, new RegExp(`^${name}=`, 'm'));
  }
  assert.doesNotMatch(example, /^(?:DB_PASSWORD|LINE_CHANNEL_SECRET|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|CHECKSLIP_API_KEY|SLIP_OBJECT_STORAGE_SECRET_KEY)=.+$/m);

  for (const name of ['NODE_ENV', 'HOST', 'PORT', 'APP_PUBLIC_URL', 'TRUST_PROXY_HOPS',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL_MODE', 'DB_SSL_CA_FILE',
    'LINE_CHANNEL_ID', 'LINE_CHANNEL_SECRET', 'LINE_LIFF_ID', 'LINE_MESSAGING_MODE',
    'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', 'LINE_WEBHOOK_SECRET', 'PAYMENT_VERIFICATION_MODE',
    'CHECKSLIP_API_URL', 'CHECKSLIP_API_KEY', 'SLIP_STORAGE_MODE', 'SLIP_OBJECT_STORAGE_ENDPOINT',
    'SLIP_OBJECT_STORAGE_REGION', 'SLIP_OBJECT_STORAGE_BUCKET', 'SLIP_OBJECT_STORAGE_ACCESS_KEY',
    'SLIP_OBJECT_STORAGE_SECRET_KEY', 'SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE', 'SLIP_OBJECT_STORAGE_CA_FILE']) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} must be documented`);
  }

  const deploy = read('deploy/scripts/deploy-backend.sh');
  for (const factory of ['databaseConfig', 'serverConfig', 'paymentConfig', 'customerAuthConfig',
    'merchantStaffAuthConfig', 'lineIntegrationConfig', 'securityConfig']) {
    assert.match(deploy, new RegExp(`\\b${factory}\\b`));
  }
  assert.match(deploy, /createSlipStorage\(paymentConfig\(\)\)/);
  assert.match(deploy, /systemctl restart select-topic-2-backend\.service/);
  assert.doesNotMatch(deploy, /production adapter is not implemented/);
});

test('production migration stays explicit, target-confirmed and never seeds', () => {
  const migration = read('deploy/scripts/migrate-production.sh');
  assert.match(migration, /CONFIRM_DB_TARGET/);
  assert.match(migration, /preflight-production-db\.cjs --migration-ready/);
  assert.match(migration, /db:migrate/);
  assert.doesNotMatch(migration, /db:seed|db:rollback/);
  const preflight = read('backend/scripts/preflight-production-db.cjs');
  assert.match(preflight, /10\.0\.7\.7/);
  assert.match(preflight, /PRODUCTION_DB_BACKUP_REFERENCE/);
  assert.match(preflight, /Migration history is unknown, out of order, or has a gap/);
});
