const fs = require('node:fs');
const path = require('node:path');
require('../src/env.cjs');
const knex = require('knex');
const { databaseConfig } = require('../src/config.cjs');

const migrationReady = process.argv.includes('--migration-ready');
const expected = fs.readdirSync(path.resolve(__dirname, '../migrations'))
  .filter((name) => /^\d{12}_.+\.cjs$/.test(name))
  .sort();

async function main() {
  if (process.env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production');
  const config = databaseConfig(process.env, { required: true });
  const connection = config.connection;
  if (connection.host !== '10.0.7.7' || connection.port !== 5432) {
    throw new Error('Production database target must be 10.0.7.7:5432');
  }
  if (/local|test/i.test(connection.database)) throw new Error('Refusing a local/test database name');

  const target = `${connection.host}/${connection.database}`;
  if (migrationReady && process.env.CONFIRM_DB_TARGET !== target) {
    throw new Error(`Set CONFIRM_DB_TARGET exactly to ${target}`);
  }

  const db = knex(config);
  try {
    const identity = (await db.raw(
      'select current_database() as database, inet_server_addr()::text as server_address, inet_server_port() as server_port',
    )).rows[0];
    if (identity.database !== connection.database || identity.server_address !== connection.host
      || Number(identity.server_port) !== connection.port) {
      throw new Error('Connected database identity does not match configured target');
    }

    const migrationTable = (await db.raw("select to_regclass('public.knex_migrations') is not null as present"))
      .rows[0].present;
    const applied = migrationTable
      ? (await db('knex_migrations').select('name').orderBy('id')).map((row) => row.name)
      : [];
    if (applied.some((name, index) => name !== expected[index])) {
      throw new Error('Migration history is unknown, out of order, or has a gap');
    }
    const pending = expected.slice(applied.length);

    const tables = await db('information_schema.tables')
      .select('table_name')
      .where({ table_schema: 'public', table_type: 'BASE TABLE' })
      .whereNotIn('table_name', ['knex_migrations', 'knex_migrations_lock'])
      .orderBy('table_name');
    const populated = [];
    for (const { table_name: table } of tables) {
      if (await db(table).first(db.raw('1 as present'))) populated.push(table);
    }
    if (migrationReady && populated.length && !process.env.PRODUCTION_DB_BACKUP_REFERENCE) {
      throw new Error('Production data exists; set PRODUCTION_DB_BACKUP_REFERENCE after a verified backup');
    }

    console.log(JSON.stringify({
      target: { host: connection.host, port: connection.port, database: identity.database, ssl: process.env.DB_SSL_MODE },
      state: applied.length === 0 && tables.length === 0 ? 'EMPTY' : 'EXISTING',
      applied,
      pending,
      populatedTableCount: populated.length,
      backupRequired: populated.length > 0,
      migrationReady,
    }, null, 2));
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  const safe = error.code && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : '';
  let message = String(error.message || 'unexpected error');
  for (const name of ['DB_PASSWORD', 'LINE_CHANNEL_SECRET', 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
    'CHECKSLIP_API_KEY', 'SLIP_OBJECT_STORAGE_ACCESS_KEY', 'SLIP_OBJECT_STORAGE_SECRET_KEY']) {
    if (process.env[name]) message = message.replaceAll(process.env[name], '[REDACTED]');
  }
  console.error(`Production database preflight failed${safe}: ${message}`);
  process.exitCode = 1;
});
