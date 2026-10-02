#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
sudo apt-get update
sudo apt-get install -y ca-certificates curl xz-utils
install_node_if_missing
ensure_env backend
echo 'Set backend/.env (HOST=10.0.7.6 and DB_*), then run bash deploy/scripts/deploy-backend.sh'
