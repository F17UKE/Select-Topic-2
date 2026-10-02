const path = require('node:path');
const root = path.resolve(__dirname, '../..');

module.exports = { apps: [{
  name: 'select-topic-2-backend',
  cwd: path.join(root, 'backend'),
  script: path.join(root, 'backend/src/server.cjs'),
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  min_uptime: '10s',
  max_restarts: 10,
  exp_backoff_restart_delay: 1000,
  max_memory_restart: '220M',
  kill_timeout: 10000,
  time: true,
  // Credentials are read by the backend from backend/.env at process startup.
  env: { NODE_ENV: 'production' },
}] };
