require('../src/env.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createFinanceService } = require('../src/finance-service.cjs');
const db = createDatabase(process.env, { required: true });
createFinanceService(db).runScheduled().then(result => console.log(JSON.stringify(result)))
  .catch(() => { console.error('Finance scheduled run failed; inspect reconciliation before retrying'); process.exitCode = 1; })
  .finally(() => db.destroy());
