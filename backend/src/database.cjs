const knex = require('knex');
const { databaseConfig } = require('./config.cjs');

function createDatabase(env = process.env, options) {
  const config = databaseConfig(env, options);
  return config ? knex(config) : null;
}

function createDatabaseProbe(db) {
  // Share concurrent probes so repeated health requests do not exhaust the tiny pool.
  let pending;
  return function checkDatabase() {
    if (!db) return Promise.resolve({ status: 'not_configured' });
    if (!pending) {
      pending = Promise.resolve().then(() => db.raw('SELECT 1 AS ok'))
        .then(() => ({ status: 'ok' }), () => ({ status: 'unavailable' }))
        .finally(() => { pending = undefined; });
    }
    return pending;
  };
}

module.exports = { createDatabase, createDatabaseProbe };
