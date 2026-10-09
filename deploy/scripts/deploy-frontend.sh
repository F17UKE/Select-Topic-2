#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
require_ubuntu
require_standard_release_path
require_node
cd "$REPO_ROOT"
run_root test -r "$FRONTEND_ENV_FILE" || { echo "Missing $FRONTEND_ENV_FILE; run setup-frontend.sh first." >&2; exit 1; }
npm ci --include=dev --workspace frontend --include-workspace-root --no-audit --no-fund
# Build in one worker, cap JS heap; do not modify swap automatically.
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="${BUILD_NODE_OPTIONS:---max-old-space-size=640}" npm run build --workspace frontend
# Build tooling is not needed by the running Next.js server. Prune it before service restart.
npm prune --omit=dev --workspace frontend --include-workspace-root --no-audit --no-fund
run_root install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$REPO_ROOT/frontend/.next/cache"
run_root chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_ROOT/frontend/.next/cache"
install_service_unit select-topic-2-frontend
run_root systemctl enable select-topic-2-frontend.service
run_root systemctl restart select-topic-2-frontend.service
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 10 \
  http://127.0.0.1:3000/health
echo

# Refuse to overwrite a different site. Back up the stock default link/file before disabling it.
site=/etc/nginx/sites-available/select-topic-2
enabled=/etc/nginx/sites-enabled/select-topic-2
source_config="$REPO_ROOT/deploy/nginx/select-topic-2.conf"
if run_root test -e "$site" && ! run_root cmp -s "$source_config" "$site"; then
  echo "Existing $site differs. Review and install the config manually (README)." >&2; exit 1
fi
was_enabled=false
if [[ -e "$enabled" || -L "$enabled" ]]; then
  [[ -L "$enabled" && "$(readlink "$enabled")" == "$site" ]] \
    || { echo "Refusing to overwrite $enabled" >&2; exit 1; }
  was_enabled=true
fi
default=/etc/nginx/sites-enabled/default
backup=/etc/nginx/select-topic-2-default.backup
for other in /etc/nginx/sites-enabled/*; do
  [[ -e "$other" || -L "$other" ]] || continue
  if [[ "$other" != "$default" && "$other" != "$enabled" ]]; then
    echo "Other active Nginx site detected: $other. Review installation manually." >&2; exit 1
  fi
done
moved_default=false
if [[ -e "$default" || -L "$default" ]]; then
  if [[ ! -L "$default" || "$(readlink -f "$default")" != /etc/nginx/sites-available/default ]]; then
    echo 'Non-stock default site detected. Review Nginx sites manually.' >&2; exit 1
  fi
  if [[ -e "$backup" || -L "$backup" ]]; then
    echo 'Default backup already exists; review Nginx sites manually.' >&2; exit 1
  fi
  run_root mv "$default" "$backup"
  moved_default=true
fi
run_root install -m 644 "$source_config" "$site"
run_root ln -sfn "$site" "$enabled"
if ! run_root nginx -t; then
  if [[ "$was_enabled" == false ]]; then run_root rm -f "$enabled"; fi
  if [[ "$moved_default" == true ]]; then run_root mv "$backup" "$default"; fi
  echo 'Nginx validation failed; enabled-site changes rolled back. Running Nginx was not reloaded.' >&2
  exit 1
fi
run_root systemctl enable --now nginx
run_root systemctl reload nginx
bash deploy/scripts/verify-frontend.sh http://127.0.0.1
echo 'Frontend ready under systemd.'
