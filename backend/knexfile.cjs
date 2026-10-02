require('./src/env.cjs');
const { databaseConfig } = require('./src/config.cjs');
module.exports = databaseConfig(process.env, { required: true });
