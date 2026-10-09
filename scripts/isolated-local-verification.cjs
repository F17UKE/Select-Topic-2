// Mutating verification runs only in a disposable copy of the local public schema.
// No migrations, seed, real providers, or writes to the demo tables are performed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('../backend/src/env.cjs');
const { createDatabase } = require('../backend/src/database.cjs');

const root = path.resolve(__dirname, '..');
async function main() {
  // Finance history is intentionally immutable. Give each suite a fresh clone,
  // rather than deleting ledger fixtures or letting them change later smoke assumptions.
  if (process.argv.length === 2) {
    const commands = [
      ['--test','--test-concurrency=1',...fs.readdirSync(path.join(root,'backend/test')).filter(n=>n.endsWith('.test.cjs')).map(n=>`backend/test/${n}`)],
      ['scripts/customer-browsing-smoke.cjs'],['scripts/payment-smoke.cjs'],
      ['scripts/payment-smoke.cjs','--promotion'],['scripts/payment-smoke.cjs','--phase-i'],['scripts/admin-smoke.cjs'],
    ];
    for (const args of commands) {
      const result=spawnSync(process.execPath,[__filename,...args],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
      assert.equal(result.status,0,`Isolated suite failed: ${args[0]}`);
    }
    return;
  }
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
  assert.equal(process.env.DB_NAME, 'select_topic_2_local');
  assert.ok(!process.env.PGOPTIONS, 'Do not inherit an unknown PostgreSQL search path');
  const bin = process.env.LOCAL_PG_BIN || path.join(process.env.LOCALAPPDATA || '', 'select-topic-2', 'postgresql-16.15', 'pgsql', 'bin');
  const executable = (name) => path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  for (const name of ['pg_dump', 'psql']) assert.ok(fs.existsSync(executable(name)), `Set LOCAL_PG_BIN to the existing PostgreSQL bin directory (${name})`);
  const schema = `p0_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = createDatabase(process.env, { required: true });
  const pgEnv = { ...process.env, PGHOST: process.env.DB_HOST, PGPORT: process.env.DB_PORT || '5432',
    PGDATABASE: process.env.DB_NAME, PGUSER: process.env.DB_USER, PGPASSWORD: process.env.DB_PASSWORD };
  const digest = async () => {
    const tables = await db('information_schema.tables').where({ table_schema: 'public', table_type: 'BASE TABLE' }).orderBy('table_name').pluck('table_name');
    const result = {};
    for (const table of tables) {
      const rows = await db.withSchema('public').from(table).select('*');
      result[table] = { count: rows.length, hash: crypto.createHash('sha256').update(rows.map((row) => JSON.stringify(row)).sort().join('\n')).digest('hex') };
    }
    return result;
  };
  const before = await digest();
  try {
    const dump = spawnSync(executable('pg_dump'), ['--schema=public', '--no-owner', '--no-acl'],
      { env: pgEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
    assert.equal(dump.status, 0, 'Local snapshot failed; database output suppressed to protect demo data');
    let inCopy = false;
    const sql = dump.stdout.split('\n').map((line) => {
      if (inCopy) { if (line.trim() === '\\.') inCopy = false; return line; }
      if (line.startsWith('COPY ')) inCopy = true;
      return line.replace(/\bpublic\./g, `${schema}.`).replace(/\bSCHEMA public\b/g, `SCHEMA ${schema}`);
    }).join('\n');
    await db.raw('CREATE SCHEMA ??', [schema]);
    // Some PostgreSQL versions include CREATE SCHEMA public in the dump.
    const restored = spawnSync(executable('psql'), ['-X', '--quiet', '--set=ON_ERROR_STOP=1'], {
      env: pgEnv, input: sql.replace(new RegExp(`CREATE SCHEMA ${schema};`, 'g'), ''),
      encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(restored.status, 0, 'Isolated snapshot restore failed; SQL/data output suppressed');
    // DB overrides must never switch automated verification to a real provider.
    if (await db.schema.withSchema(schema).hasTable('integration_settings')) await db.withSchema(schema).from('integration_settings').delete();
    // A live demo may intentionally run centralized collection. The finance suite owns
    // that cutover sequence and must start from its documented legacy baseline inside
    // the disposable schema; public runtime configuration remains untouched.
    if (await db.schema.withSchema(schema).hasTable('system_settings')) {
      await db.withSchema(schema).from('system_settings').where({ setting_key: 'finance.runtime' }).update({
        setting_value: JSON.stringify({ mode: 'LEGACY_MERCHANT_DIRECT' }), updated_at: db.fn.now(),
      });
    }
    const childEnv = { ...process.env, PGOPTIONS: `-c search_path=${schema}`, NODE_ENV: 'test',
      LINE_MESSAGING_MODE: 'disabled', PAYMENT_VERIFICATION_MODE: 'mock', SLIP_STORAGE_MODE: 'local' };
    const probe = spawnSync(process.execPath, ['-e', "require('./backend/src/env.cjs');const db=require('./backend/src/database.cjs').createDatabase();db.raw('select current_schema() as name').then(r=>{if(r.rows[0].name!==process.argv[1])process.exitCode=1}).finally(()=>db.destroy())", schema],
      { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
    assert.equal(probe.status, 0, 'Isolated search path must resolve before tests');
    console.log(`Isolated local verification: ${schema}; public demo tables excluded from search_path`);
    const requested = process.argv.slice(2);
    const commands = requested.length ? [requested] : [
      ['--test', '--test-concurrency=1', ...fs.readdirSync(path.join(root, 'backend/test')).filter((name) => name.endsWith('.test.cjs')).map((name) => `backend/test/${name}`)],
      ['scripts/customer-browsing-smoke.cjs'], ['scripts/payment-smoke.cjs'],
      ['scripts/payment-smoke.cjs', '--promotion'], ['scripts/payment-smoke.cjs', '--phase-i'], ['scripts/admin-smoke.cjs'],
    ];
    for (const args of commands) {
      const result = spawnSync(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
      assert.equal(result.status, 0, `Verification failed: ${args[0]}`);
    }
  } finally {
    try {
      assert.match(schema, /^p0_test_[a-f0-9]{16}$/);
      await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
      assert.deepEqual(await digest(), before, 'Public demo data changed during verification');
      console.log(`PASS demo preservation: ${Object.keys(before).length} public tables unchanged; disposable schema removed`);
    } finally { await db.destroy(); }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
