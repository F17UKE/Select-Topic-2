#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
sudo apt-get update
sudo apt-get install -y ca-certificates curl xz-utils nginx
install_node_if_missing
ensure_env frontend
echo 'Frontend prerequisites ready. Next: bash deploy/scripts/deploy-frontend.sh'
