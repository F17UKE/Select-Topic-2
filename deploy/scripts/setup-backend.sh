#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_standard_release_path
cd "$REPO_ROOT"
run_root apt-get update
run_root apt-get install -y ca-certificates curl xz-utils
install_node_if_missing
ensure_service_user
run_root install -d -o root -g "$SERVICE_USER" -m 0750 /etc/select-topic-2
if ! run_root test -e "$BACKEND_ENV_FILE"; then
  run_root install -m 0600 backend/.env.example "$BACKEND_ENV_FILE"
  echo "Created $BACKEND_ENV_FILE from the secret-free template. Fill it on this host."
fi
install_service_unit select-topic-2-backend
echo "Set $BACKEND_ENV_FILE, then run bash deploy/scripts/deploy-backend.sh"
