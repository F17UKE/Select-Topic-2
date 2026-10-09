#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_standard_release_path
require_node
cd "$REPO_ROOT"
run_root test -r "$BACKEND_ENV_FILE" || { echo "Missing $BACKEND_ENV_FILE; run setup-backend.sh and fill it first." >&2; exit 1; }
npm ci --omit=dev --workspace backend --include-workspace-root --no-audit --no-fund
node --env-file="$BACKEND_ENV_FILE" - <<'NODE'
require('./backend/src/env.cjs');
const { createDatabase } = require('./backend/src/database.cjs');
const { createIntegrationSettings } = require('./backend/src/integration-settings.cjs');
const db = createDatabase(process.env, { required: true });
(async () => {
try {
Object.assign(process.env, await createIntegrationSettings({ db }).environment());
const required = [
  'APP_PUBLIC_URL', 'LINE_CHANNEL_ID', 'LINE_LIFF_ID',
  'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN',
  'SLIP_OBJECT_STORAGE_ENDPOINT', 'SLIP_OBJECT_STORAGE_REGION', 'SLIP_OBJECT_STORAGE_BUCKET',
  'SLIP_OBJECT_STORAGE_ACCESS_KEY', 'SLIP_OBJECT_STORAGE_SECRET_KEY',
  'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL_MODE',
];
const invalid = required.filter((name) => !process.env[name]
  || /YOUR_|CHANGE_ME|<[^>]+>/i.test(process.env[name]));
if (invalid.length) throw new Error(`Missing or placeholder production variables: ${invalid.join(', ')}`);
const { databaseConfig, serverConfig, paymentConfig } = require('./backend/src/config.cjs');
const { createSlipStorage } = require('./backend/src/slip-storage.cjs');
const { customerAuthConfig } = require('./backend/src/auth.cjs');
const { merchantStaffAuthConfig } = require('./backend/src/staff-auth.cjs');
const { lineIntegrationConfig } = require('./backend/src/line-config.cjs');
const { securityConfig } = require('./backend/src/security-config.cjs');
const { validateProductionPaymentEnvironment } = require('./backend/scripts/payment-preflight.cjs');
databaseConfig(process.env, { required: true });
const { host, port } = serverConfig();
if (host !== '10.0.7.6' || port !== 3001) throw new Error('Cloud backend must use HOST=10.0.7.6 and PORT=3001');
customerAuthConfig();
merchantStaffAuthConfig();
lineIntegrationConfig();
securityConfig();
validateProductionPaymentEnvironment();
createSlipStorage(paymentConfig());
} finally { await db.destroy(); }
})().catch(() => { console.error('Production integration preflight failed; check required configuration and encryption key'); process.exitCode = 1; });
NODE
# SELECT 1 only; NEVER migrate automatically.
npm_with_backend_env run db:check --workspace backend
install_service_unit select-topic-2-backend
run_root systemctl enable select-topic-2-backend.service
run_root systemctl restart select-topic-2-backend.service
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 10 \
  http://10.0.7.6:3001/api/health
echo
echo 'Backend ready under systemd; migration remains a separate reviewed step.'
