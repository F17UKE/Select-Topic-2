require('../src/env.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');

async function main() {
  let db;
  try {
    db = createDatabase(process.env, { required: true });
    const result = await createDatabaseProbe(db)();
    console.log(JSON.stringify({ database: result }));
    process.exitCode = result.status === 'ok' ? 0 : 1;
  } catch {
    // Never include connection strings, passwords, or provider errors in output.
    console.error('Database check failed. Check backend environment and private network access.');
    process.exitCode = 1;
  } finally { if (db) await db.destroy(); }
}
main();
