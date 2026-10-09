// Local-only Admin Backoffice smoke. Never targets Cloud Lab or changes business data.
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
require('../backend/src/env.cjs');
const { createDatabase } = require('../backend/src/database.cjs');

const root = path.resolve(__dirname, '..');

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Backend exited with code ${child.exitCode}`);
    try { return await fetch(url, { signal: AbortSignal.timeout(2000) }); }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  await exited;
  clearTimeout(timer);
}

async function main() {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DB_NAME, 'select_topic_2_local');
  const db = createDatabase(process.env, { required: true });
  const baselineAudit = Number((await db('audit_logs').max('id as id').first()).id || 0);
  const baselineSession = Number((await db('platform_admin_sessions').max('id as id').first()).id || 0);
  const admin = await db('platform_admins').where({ username: 'local_super_admin' }).first('id');
  assert.ok(admin, 'Run the local seed before Admin smoke');
  const port = await unusedPort();
  const backend = spawn(process.execPath, [path.join(root, 'backend/src/server.cjs')], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await waitFor(`${origin}/api/health`, backend)).status, 200);
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'local_super_admin', password: 'local-admin-only' }),
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.admin.role, 'SUPER_ADMIN');
    const cookies = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    for (const route of ['/api/admin/dashboard', '/api/admin/merchants?limit=2', '/api/admin/customers?limit=2',
      '/api/admin/orders?limit=2', '/api/admin/payments?limit=2', '/api/admin/system-status', '/api/admin/reports']) {
      const response = await fetch(`${origin}${route}`, { headers: { cookie: cookies } });
      assert.equal(response.status, 200, `${route} returned ${response.status}`);
    }
    const logout = await fetch(`${origin}/api/admin/auth/logout`, {
      method: 'POST', headers: { cookie: cookies, 'x-csrf-token': loginBody.csrf_token },
    });
    assert.equal(logout.status, 204);
    console.log('PASS admin smoke: isolated login/session, dashboard, management views, system status, reports and logout');
  } finally {
    await stop(backend);
    await db('platform_admin_sessions').where({ admin_id: admin.id }).where('id', '>', baselineSession).delete();
    await db('audit_logs').where('id', '>', baselineAudit).where({ actor_type: 'ADMIN', actor_id: admin.id }).delete();
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
