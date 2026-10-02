// Local production-process smoke checks. Never targets Cloud Lab or runs migrations.
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
async function unusedPort() {
  const server = await reservePort();
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function waitFor(url, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
    try { return await fetch(url, { signal: AbortSignal.timeout(5000) }); }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 9000);
  await exited;
  clearTimeout(timer);
}

async function main() {
  const children = [];
  // A local TCP sink gives a deterministic PostgreSQL handshake timeout without a DB.
  const sockets = new Set();
  const sink = await reservePort();
  sink.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  try {
    const apiPort = await unusedPort();
    const webPort = await unusedPort();
    const productionEnv = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(apiPort),
        APP_PUBLIC_URL: 'https://app.example.invalid', TRUST_PROXY_HOPS: '1',
        CUSTOMER_AUTH_MODE: 'line', ENABLE_DEV_LOGIN: 'false',
        LINE_CHANNEL_ID: 'smoke-channel', LINE_LIFF_ID: 'smoke-liff',
        LINE_CHANNEL_SECRET: 'smoke-webhook-secret', LINE_MESSAGING_MODE: 'real',
        LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'synthetic-smoke-token',
        PAYMENT_VERIFICATION_MODE: 'checkslip',
        CHECKSLIP_API_URL: 'https://provider.example.invalid/api/line/apikey/smoke-branch',
        CHECKSLIP_API_KEY: 'synthetic-smoke-key',
        SLIP_STORAGE_MODE: 'object', SLIP_OBJECT_STORAGE_ENDPOINT: 'https://storage.example.invalid',
        SLIP_OBJECT_STORAGE_REGION: 'ap-southeast-1',
        SLIP_OBJECT_STORAGE_BUCKET: 'smoke', SLIP_OBJECT_STORAGE_ACCESS_KEY: 'synthetic-access',
        SLIP_OBJECT_STORAGE_SECRET_KEY: 'synthetic-secret',
        SLIP_OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
        MERCHANT_STAFF_AUTH_MODE: 'password', ENABLE_STAFF_DEV_LOGIN: 'false',
        DB_HOST: '127.0.0.1', DB_PORT: String(sink.address().port), DB_NAME: 'smoke',
        DB_USER: 'smoke', DB_PASSWORD: 'synthetic-test-input', DB_SSL_MODE: 'disable', DB_SSL_CA_FILE: '',
        DB_POOL_MAX: '1', DB_CONNECT_TIMEOUT_MS: '300', DB_QUERY_TIMEOUT_MS: '300' };
    const backend = spawn(process.execPath, [path.join(root, 'backend/src/server.cjs')], {
      cwd: root,
      env: productionEnv,
      stdio: 'ignore',
    });
    children.push(backend);
    const api = await waitFor(`http://127.0.0.1:${apiPort}/api/health`, backend);
    assert.equal(api.status, 503);
    assert.deepEqual(await api.json(), { status: 'degraded', api: { status: 'ok' }, database: { status: 'unavailable' } });
    const webhook = await fetch(`http://127.0.0.1:${apiPort}/api/webhooks/line`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"events":[]}',
    });
    assert.equal(webhook.status, 401);
    console.log('PASS backend production process: object storage config accepted; PostgreSQL timeout -> sanitized 503; unsigned webhook -> 401');

    const frontend = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], {
      cwd: path.join(root, 'frontend'), env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore',
    });
    children.push(frontend);
    const health = await waitFor(`http://127.0.0.1:${webPort}/health`, frontend);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { service: 'frontend', status: 'ok' });
    const page = await fetch(`http://127.0.0.1:${webPort}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Select Topic 2/);
    const directApi = await fetch(`http://127.0.0.1:${webPort}/api/health`);
    assert.equal(directApi.status, 404, 'Production API proxy belongs to Nginx');
    console.log('PASS frontend production process: page/health -> 200; direct API -> 404 as designed');
  } finally {
    for (const child of children.reverse()) await stop(child);
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => sink.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
