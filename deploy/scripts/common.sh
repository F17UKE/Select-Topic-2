#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_USER=select-topic-2
BACKEND_ENV_FILE=/etc/select-topic-2/backend.env
FRONTEND_ENV_FILE=/etc/select-topic-2/frontend.env

if [[ "$EUID" -eq 0 ]]; then
  ROOT=()
else
  ROOT=(sudo)
fi

run_root() { "${ROOT[@]}" "$@"; }

require_ubuntu() {
  if [[ ! -r /etc/os-release ]]; then echo 'Ubuntu 24.04 is required.' >&2; exit 1; fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then
    echo 'These scripts support Ubuntu 24.04 only.' >&2; exit 1
  fi
  if [[ "$EUID" -ne 0 ]]; then
    command -v sudo >/dev/null || { echo 'Run as root or install sudo for the deployment user.' >&2; exit 1; }
  fi
}

require_node() {
  command -v node >/dev/null || { echo 'Run the setup script first.' >&2; exit 1; }
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (!((major === 22 && minor >= 19) || major === 24)) process.exit(1)' \
    || { echo 'Node 22.19+ (22.x) or 24.x is required.' >&2; exit 1; }
  command -v npm >/dev/null
}

install_node_if_missing() {
  if command -v node >/dev/null; then require_node; return; fi
  local version arch archive temporary
  version="$(tr -d '\r\n' < "$REPO_ROOT/.nvmrc")"
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo 'Unsupported CPU architecture' >&2; exit 1 ;; esac
  archive="node-v${version}-linux-${arch}.tar.xz"
  temporary="$(mktemp -d)"
  (
    trap 'rm -rf -- "$temporary"' EXIT
    cd "$temporary"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v${version}/${archive}" -o "$archive"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v${version}/SHASUMS256.txt" -o SHASUMS256.txt
    grep "  ${archive}\$" SHASUMS256.txt | sha256sum --check --status
    run_root tar -xJf "$archive" -C /opt
    for executable in node npm npx; do
      run_root ln -sfn "/opt/node-v${version}-linux-${arch}/bin/${executable}" "/usr/local/bin/${executable}"
    done
  )
  require_node
}

require_standard_release_path() {
  [[ "$REPO_ROOT" == /opt/select-topic-2 ]] || {
    echo 'Production releases must be checked out at /opt/select-topic-2.' >&2
    exit 1
  }
}

ensure_service_user() {
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    run_root useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

install_service_unit() {
  local name="$1"
  run_root install -m 0644 "$REPO_ROOT/deploy/systemd/${name}.service" "/etc/systemd/system/${name}.service"
  run_root systemctl daemon-reload
}

npm_with_backend_env() {
  local npm_cli
  npm_cli="$(readlink -f "$(command -v npm)")"
  node --env-file="$BACKEND_ENV_FILE" "$npm_cli" "$@"
}
