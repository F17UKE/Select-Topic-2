const path = require('node:path');
const root = path.resolve(__dirname, '../..');

module.exports = { apps: [{
  name: 'select-topic-2-frontend',
  cwd: path.join(root, 'frontend'),
  script: require.resolve('next/dist/bin/next'),
  args: 'start --hostname 127.0.0.1 --port 3000',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  min_uptime: '10s',
  max_restarts: 10,
  exp_backoff_restart_delay: 1000,
  max_memory_restart: '350M',
  kill_timeout: 10000,
  time: true,
  env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
}] };
