# Production Deployment Checklist

This checklist prepares the approved release; it does not authorize deployment. Never copy local
`.env`, PostgreSQL data, uploaded slips, test credentials or seed records to Cloud.

## 1. Release gate

- [ ] Record the reviewed commit SHA and confirm both application hosts use that exact revision.
- [ ] `git diff --check`, `npm ci`, `npm run verify`, `npm run test:smoke:final`,
  `npm run test:smoke:local`, `npm run test:smoke` and `npm run security:scan` pass.
- [ ] `npm audit --omit=dev` reports zero production vulnerabilities; review the separate dev audit.
- [ ] Migrations 001–006 are complete locally with no pending migration.
- [ ] No `.env`, credential, private key/certificate, uploaded slip, PostgreSQL data, `node_modules`,
  `.next`, log or PID file is tracked.

## 2. Hosts and network

- [ ] Bastion is `root@45.77.40.35:22007`; hop only to the three approved internal hosts.
- [ ] Frontend `10.0.7.5`: Nginx public 80/443; Next.js loopback `127.0.0.1:3000`.
- [ ] Backend `10.0.7.6`: Express private `10.0.7.6:3001`; allow frontend source only.
- [ ] PostgreSQL `10.0.7.7:5432`: allow backend `10.0.7.6` only.
- [ ] Clone the reviewed revision at `/opt/select-topic-2` on frontend and backend.
- [ ] DNS resolves to the frontend before installing the HTTPS config.

## 3. Backend environment outside Git

`setup-backend.sh` creates `/etc/select-topic-2/backend.env` mode 0600 from the secret-free example.
Fill it only on the backend host. Required groups:

| Group | Values |
|---|---|
| Runtime | `NODE_ENV=production`, `HOST=10.0.7.6`, `PORT=3001`, `APP_PUBLIC_URL=https://<domain>`, `TRUST_PROXY_HOPS=1` |
| Customer | `CUSTOMER_AUTH_MODE=line`, `ENABLE_DEV_LOGIN=false` |
| Staff | `MERCHANT_STAFF_AUTH_MODE=password`, `ENABLE_STAFF_DEV_LOGIN=false` |
| PostgreSQL | `DB_HOST=10.0.7.7`, `DB_PORT=5432`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_MODE`, optional `DB_SSL_CA_FILE` |
| LINE | `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LINE_LIFF_ID`, `LINE_MESSAGING_MODE=real`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, optional distinct `LINE_WEBHOOK_SECRET` |
| SlipOK | `PAYMENT_VERIFICATION_MODE=checkslip`, `CHECKSLIP_API_URL`, `CHECKSLIP_API_KEY` |
| Storage | `SLIP_STORAGE_MODE=object`, endpoint, region, private bucket, access/secret keys, force-path-style, optional CA file |

`setup-frontend.sh` creates `/etc/select-topic-2/frontend.env` with only `NODE_ENV=production` and
`NEXT_TELEMETRY_DISABLED=1`. No backend or provider secret belongs on the frontend host.
Install any DB/object-storage CA bundle as `root:select-topic-2` mode 0640 under
`/etc/select-topic-2`; keep the environment files root-owned mode 0600.

## 4. Database safety and migration

Run from `/opt/select-topic-2` on the backend after network/TLS validation. The read-only preflight
refuses any target except `10.0.7.7:5432`, rejects local/test database names, and validates that
migration history is an exact prefix of 001–006.

```bash
node --env-file=/etc/select-topic-2/backend.env backend/scripts/preflight-production-db.cjs
```

If the preflight reports populated tables, create and verify a backup first. Then use the exact target
confirmation; provide a backup reference only when data exists:

```bash
export CONFIRM_DB_TARGET='10.0.7.7/<production-db-name>'
export PRODUCTION_DB_BACKUP_REFERENCE='<backup-id-or-path>' # only when required
bash deploy/scripts/migrate-production.sh
unset CONFIRM_DB_TARGET PRODUCTION_DB_BACKUP_REFERENCE
```

Expected order: 001, 002, 003, 004, 005, 006; pending 0. The migration script never runs seed or
rollback. Never invoke `db:seed` on production.

## 5. Install and start systemd services

On each approved host, at `/opt/select-topic-2`:

```bash
bash deploy/scripts/setup-backend.sh   # backend only
bash deploy/scripts/deploy-backend.sh  # after migration/provider config

bash deploy/scripts/setup-frontend.sh  # frontend only
bash deploy/scripts/deploy-frontend.sh
```

The units are `select-topic-2-backend.service` and `select-topic-2-frontend.service`. Each starts one
Node process, restarts on failure, starts at boot, runs as the unprivileged `select-topic-2` user and
reads its environment from `/etc/select-topic-2`. Logs go to journald.

```bash
systemctl status select-topic-2-backend --no-pager
systemctl status select-topic-2-frontend --no-pager
journalctl -u select-topic-2-backend -n 50 --no-pager
journalctl -u select-topic-2-frontend -n 50 --no-pager
```

## 6. Nginx and TLS

`deploy/nginx/select-topic-2.conf` is an HTTP bootstrap config. After DNS and certificate paths are
known, render and validate the HTTPS template:

```bash
bash deploy/scripts/configure-nginx-tls.sh <domain> /absolute/fullchain.pem /absolute/privkey.pem
```

The rendered config redirects HTTP to HTTPS, sets HSTS only on the TLS virtual host, overwrites
`Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto`, and routes:

- `/` to `127.0.0.1:3000`
- `/api/*` and `/api/webhooks/line` to `10.0.7.6:3001` with the path preserved
- `/webhooks/line` to `10.0.7.6:3001/webhooks/line`

Always run `nginx -t` before reload. Do not enable HSTS until the domain and certificate are working.

## 7. Health and reboot proof

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://10.0.7.6:3001/api/health
curl -fsS https://<domain>/api/health
curl -i -H 'Content-Type: application/json' -d '{"events":[]}' https://<domain>/webhooks/line
bash deploy/scripts/verify-frontend.sh https://<domain>
```

Health must report frontend/API/database `ok`; unsigned webhook calls must return 401. After an
approved reboot, prove PostgreSQL reachability, all three `systemctl is-active` results, both health
routes and Nginx proxy behavior again.

## 8. Provider verification after HTTPS

Automated tests never call real providers. Use production-safe accounts/data and redact logs.

- LINE: set LIFF endpoint `https://<domain>/`; webhook
  `https://<domain>/api/webhooks/line`; verify login, ID token audience, webhook Verify,
  follow/unfollow/postback and one Flex push.
- SlipOK: run `npm run checkslip:manual --workspace backend -- /private/test-slip.png`; verify amount,
  recipient and duplicate-reference rejection.
- Object storage: run `npm run storage:test-object --workspace backend`; require upload, HEAD, delete
  and deletion confirmation in the private bucket.

## 9. Go-live controls

- [ ] Real Admin and merchant accounts exist; synthetic credentials/data are absent.
- [ ] Private bucket policy has no public-read access.
- [ ] PostgreSQL backup/restore drill, certificate renewal, log retention and monitoring are owned.
- [ ] Outbox and private-slip retention workers are monitored.
- [ ] Rollback owner and pre-deploy revision are recorded; additive migrations are retained unless a
  separately reviewed data-safe rollback says otherwise.

## EasySlip v2 opt-in readiness (not deployed)

- [ ] Merchant-specific enrollment verified; protected EASYSLIP_MERCHANT_ACCOUNTS binds the
  order merchant and its current PromptPay identifier to the exact provider bank/account.
- [ ] Full raw recipient account evidence is available and matches; masked/name-only evidence
  is blocked. Review provider/account integration rather than weakening verification.
- [ ] EASYSLIP_API_KEY exists only in backend protected environment; fixed HTTPS v2 base URL,
  connect/request bounds, private storage <=4 MiB and retention confirmed.
- [ ] Run opt-in payment:test-easyslip with an authorized private fixture outside repository.
  This script has no DB persistence. REAL PROVIDER NOT RUN during implementation.
- [ ] Owner retests payment route + success replace + failed/retry at all requested viewports.
- [ ] Reconcile any PROCESSING/ambiguous provider-duplicate result before considering payment
  again; never mark PAID from success flag/name/amount alone.
- [ ] Existing mock/CheckSlip defaults are changed only in a separately approved cutover.
# Admin integration configuration gate (2026-10-09)

- Apply reviewed additive `202610090007_integration_settings.cjs` after 001–006. No demo seed.
- Keep `INTEGRATION_SETTINGS_ENCRYPTION_KEY` (32 random bytes, base64) in the protected backend
  environment, backed up separately from the DB. Never commit it; do not replace it without a
  planned decrypt/re-encrypt procedure. Missing/wrong keys must fail closed for stored secrets.
- Deploy preflight resolves DB → ENV → default before checking provider/LINE readiness. The DB must
  be reachable and migration 007 present. Existing ENV fallback remains available for bootstrap.
- Operator must keep CUSTOMER_AUTH_MODE=line, development login disabled, staff password auth,
  private object storage, HTTPS and production cookie/proxy configuration. Admin cannot override them.
- Review selected payment provider and merchant-specific EasySlip mappings. Platform PromptPay
  fields are not connected to production payment flows; do not infer centralized-payment approval.
- Test configuration separately from real provider verification. Explicit EasySlip account test
  only checks `/v2/info`; real slip, recipient, LINE login/push/webhook and object storage still need
  controlled manual acceptance after HTTPS deployment. No live tests or deployment occurred here.

