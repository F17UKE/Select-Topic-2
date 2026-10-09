#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_standard_release_path
cd "$REPO_ROOT"

domain="${1:-}"
certificate="${2:-}"
private_key="${3:-}"
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" == *.* ]] || {
  echo 'Usage: configure-nginx-tls.sh <domain> <certificate-path> <private-key-path>' >&2; exit 1;
}
[[ "$certificate" == /* && "$private_key" == /* ]] || {
  echo 'Certificate and private-key paths must be absolute.' >&2; exit 1;
}
[[ "$certificate" =~ ^[A-Za-z0-9_./-]+$ && "$private_key" =~ ^[A-Za-z0-9_./-]+$ ]] || {
  echo 'Certificate paths contain unsupported characters.' >&2; exit 1;
}
run_root test -r "$certificate" || { echo 'Certificate is not readable.' >&2; exit 1; }
run_root test -r "$private_key" || { echo 'Private key is not readable.' >&2; exit 1; }

rendered="$(mktemp)"
backup="$(mktemp)"
trap 'rm -f -- "$rendered" "$backup"' EXIT
sed -e "s|__PRODUCTION_DOMAIN__|$domain|g" \
    -e "s|__TLS_CERTIFICATE_PATH__|$certificate|g" \
    -e "s|__TLS_PRIVATE_KEY_PATH__|$private_key|g" \
    deploy/nginx/select-topic-2-https.conf.template > "$rendered"

site=/etc/nginx/sites-available/select-topic-2
enabled=/etc/nginx/sites-enabled/select-topic-2
had_site=false
had_enabled=false
if run_root test -e "$site"; then
  run_root cp "$site" "$backup"
  had_site=true
fi
if run_root test -e "$enabled" || run_root test -L "$enabled"; then
  [[ -L "$enabled" && "$(readlink "$enabled")" == "$site" ]] || {
    echo "Refusing to overwrite unexpected $enabled" >&2; exit 1;
  }
  had_enabled=true
fi
run_root install -m 0644 "$rendered" "$site"
run_root ln -sfn "$site" "$enabled"
if ! run_root nginx -t; then
  if [[ "$had_site" == true ]]; then run_root install -m 0644 "$backup" "$site"; else run_root rm -f "$site"; fi
  if [[ "$had_enabled" == false ]]; then run_root rm -f "$enabled"; fi
  echo 'Nginx validation failed; the previous site configuration was restored.' >&2
  exit 1
fi
run_root systemctl reload nginx
echo "HTTPS Nginx configuration active for $domain."
