#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_node
cd "$REPO_ROOT"
[[ -f backend/.env ]] || { echo 'Run setup-backend.sh and fill backend/.env first.' >&2; exit 1; }
chmod 600 backend/.env
npm ci --omit=dev --workspace backend --include-workspace-root --no-audit --no-fund
node - <<'NODE'
require('./backend/src/env.cjs');
const { databaseConfig, serverConfig, paymentConfig } = require('./backend/src/config.cjs');
const { createSlipStorage } = require('./backend/src/slip-storage.cjs');
const { customerAuthConfig } = require('./backend/src/auth.cjs');
const { merchantStaffAuthConfig } = require('./backend/src/staff-auth.cjs');
const { lineIntegrationConfig } = require('./backend/src/line-config.cjs');
const { securityConfig } = require('./backend/src/security-config.cjs');
databaseConfig(process.env, { required: true });
const { host, port } = serverConfig();
if (host !== '10.0.7.6' || port !== 3001) throw new Error('Cloud backend must use HOST=10.0.7.6 and PORT=3001');
customerAuthConfig();
merchantStaffAuthConfig();
lineIntegrationConfig();
securityConfig();
createSlipStorage(paymentConfig());
NODE
# SELECT 1 only; NEVER migrate automatically.
npm run db:check --workspace backend
pm2_local startOrRestart deploy/pm2/backend.ecosystem.config.cjs --update-env
pm2_local save
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 10 \
  http://10.0.7.6:3001/api/health
echo
echo 'Backend ready. Configure PM2 startup using the README; migration remains a separate reviewed step.'
