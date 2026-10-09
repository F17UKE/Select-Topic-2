#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_standard_release_path
require_node
run_root test -r "$BACKEND_ENV_FILE" || { echo "Missing $BACKEND_ENV_FILE" >&2; exit 1; }
: "${CONFIRM_DB_TARGET:?Set CONFIRM_DB_TARGET to 10.0.7.7/<production-db-name>}"

cd "$REPO_ROOT"
node --env-file="$BACKEND_ENV_FILE" backend/scripts/preflight-production-db.cjs --migration-ready
npm_with_backend_env run db:status --workspace backend
npm_with_backend_env run db:migrate --workspace backend
npm_with_backend_env run db:status --workspace backend
echo 'Production migrations completed. No seed was run.'
