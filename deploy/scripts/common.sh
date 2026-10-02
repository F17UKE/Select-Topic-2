#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

require_ubuntu() {
  if [[ ! -r /etc/os-release ]]; then echo 'Ubuntu 24.04 is required.' >&2; exit 1; fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then
    echo 'These scripts support Ubuntu 24.04 only.' >&2; exit 1
  fi
  if [[ "$EUID" -eq 0 ]]; then echo 'Run as the deployment user with sudo access, not root.' >&2; exit 1; fi
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
    sudo tar -xJf "$archive" -C /opt
    for executable in node npm npx; do
      sudo ln -sfn "/opt/node-v${version}-linux-${arch}/bin/${executable}" "/usr/local/bin/${executable}"
    done
  )
  require_node
}

ensure_env() {
  local service="$1"
  if [[ ! -f "$REPO_ROOT/$service/.env" ]]; then
    (umask 077; cp "$REPO_ROOT/$service/.env.example" "$REPO_ROOT/$service/.env")
    echo "Created $service/.env. Review it before deploying."
  fi
  chmod 600 "$REPO_ROOT/$service/.env"
}

pm2_local() { "$REPO_ROOT/node_modules/.bin/pm2" "$@"; }
