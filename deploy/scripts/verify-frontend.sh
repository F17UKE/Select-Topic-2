#!/usr/bin/env bash
set -Eeuo pipefail
base="${1:-http://127.0.0.1}"
base="${base%/}"
curl --fail --silent --show-error --max-time 10 "$base/health" \
  | node -e 'let s=""; process.stdin.on("data", c=>s+=c).on("end",()=>{const j=JSON.parse(s); if(j.service!=="frontend" || j.status!=="ok") process.exit(1); console.log("PASS frontend health");})'
curl --fail --silent --show-error --max-time 10 "$base/api/health" \
  | node -e 'let s=""; process.stdin.on("data", c=>s+=c).on("end",()=>{const j=JSON.parse(s); if(j.api?.status!=="ok" || j.database?.status!=="ok") process.exit(1); console.log("PASS Nginx -> backend -> PostgreSQL");})'
for path in /api/webhooks/line /webhooks/line; do
  code="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' -H 'Content-Type: application/json' -d '{"events":[]}' "$base$path")"
  [[ "$code" == 401 ]] || { echo "FAIL webhook signature guard at $path: HTTP $code" >&2; exit 1; }
done
echo 'PASS both webhook routes reject unsigned requests'
