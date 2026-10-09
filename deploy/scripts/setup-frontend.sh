#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_standard_release_path
cd "$REPO_ROOT"
run_root apt-get update
run_root apt-get install -y ca-certificates curl xz-utils nginx
install_node_if_missing
ensure_service_user
run_root install -d -o root -g "$SERVICE_USER" -m 0750 /etc/select-topic-2
if ! run_root test -e "$FRONTEND_ENV_FILE"; then
  temporary="$(mktemp)"
  trap 'rm -f -- "$temporary"' EXIT
  printf '%s\n' 'NODE_ENV=production' 'NEXT_TELEMETRY_DISABLED=1' > "$temporary"
  run_root install -m 0600 "$temporary" "$FRONTEND_ENV_FILE"
fi
install_service_unit select-topic-2-frontend
echo 'Frontend prerequisites ready. Next: bash deploy/scripts/deploy-frontend.sh'
