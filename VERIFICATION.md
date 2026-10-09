# Phase J — Production Deployment Preparation (Local, 2026-10-07)

## Final Finance implementation verification — 2026-10-09

Owner Confirm Paid gate resolved: reference REQUIRED, private proof OPTIONAL. Continued from docs/FINANCE_SPRINT_PREFLIGHT.md. See [implementation/operator report](docs/FINANCE_SPRINT_REPORT.md) and [actual database catalog](docs/FINANCE_SCHEMA_IMPLEMENTED.md).

| Check / command | Result |
|---|---|
| Existing portable PostgreSQL / loopback target | PASS; 127.0.0.1:5432 / select_topic_2_local |
| Backup before migration | PASS; ignored private custom-format dump, user-only ACL |
| npm run db:migrate --workspace backend | PASS; batch 8, one additive migration |
| npm run db:status --workspace backend | PASS; 001–008 complete, pending 0 |
| npm run db:verify-local --workspace backend | PASS; 49 application / 51 public tables |
| Original data fingerprints after migration | PASS; all 37 previous application tables' original columns/rows identical; only approved legacy columns + finance.runtime added |
| Backend full suite in isolated clone | PASS; 243 tests, zero failures/skips |
| Finance integration/invariants (included above; additional final focused rerun) | PASS; 24 tests including nested tests; concurrency, RBAC/IDOR/CSRF, reauth, immutable journals, required/shared unique reference, partial refund/debt, ads and auto requests |
| node --test scripts/*.test.cjs | PASS; 179 frontend/architecture/presentation tests |
| npm run lint | PASS |
| npm run build | PASS; production Next.js build includes Admin/Merchant Finance |
| Isolated customer browsing smoke | PASS |
| Isolated cart/checkout/payment/merchant/kitchen/rider completion smoke | PASS |
| Isolated promotion and Phase I engagement/Admin smoke | PASS |
| Isolated Admin smoke | PASS |
| Browser Finance QA on isolated data | PASS; password sessions, reserve, approve, process, required reference + optional proof, PAID, cooldown rejection, ad purchase |
| Finance responsive | PASS at 390/768/1280 widths; document scroll width within viewport |
| Browser console errors/warnings | NONE captured |
| npm run security:scan | PASS; zero findings |
| npm audit --omit=dev | PASS; zero vulnerabilities |
| git -c core.safecrlf=false diff --check | PASS |
| Clone cleanup/public preservation | PASS; each suite removed only its own schema; 51 public tables unchanged |
| Real EasySlip/LINE/S3/bank movement | NOT RUN; automated providers mocked/disabled |

Historical local backfill: 16 LEGACY_DIRECT orders, 2 LEGACY_UNKNOWN promotions, 1 LEGACY_UNKNOWN coupon. Public local finance mode remains LEGACY_MERCHANT_DIRECT, with zero finance journals/synthetic balances. No seed/reset/deploy/commit/push.

The immutable Finance test fixtures cannot be row-deleted; each smoke suite gets its own disposable schema. An initial combined clone run exposed a smoke fixture-count mismatch (5 vs 3 merchants); the isolation runner now creates independent clones and the full rerun passed. Early QA/lint findings were corrected before the final pass.

Browser QA used the production frontend build and actual services with synthetic isolated data, not a real transfer. The snapshot screenshot is ignored at backend/.runtime/finance-admin-qa.png. Existing Admin design components were preserved; only Finance navigation/content and campaign funding fields were added.


## Admin Integration Settings — 2026-10-09

Status: **PARTIAL — implementation and automated checks PASS; Owner browser acceptance pending.**

- Additive migration `202610090007_integration_settings.cjs` applied to verified loopback local DB.
  Migrations 001–007 complete, pending 0. Application tables: **37**. No previous migration edited,
  no seed, no existing table altered, no financial balance/backfill. Public integration settings are
  still empty; no real credentials were entered and the ignored environment was not modified.
- Backend full suite: **200 PASS**, 0 failures/skips, including the actual deployment-preflight
  Node block with a fake DB, encrypted DB→ENV precedence, authenticated encryption/AAD, wrong key,
  RBAC/CSRF, safe GET/audit, blank/clear/fallback, concurrent version conflict, runtime key rotation,
  disabled-payment history, LINE audience/signature/token, and existing payment/IDOR tests.
- Frontend/architecture/presentation: **150 PASS**, including empty password inputs, immediate
  plaintext state clearing and role gating. Root/frontend lint and production build PASS (44 routes).
- Full isolated local E2E PASS: customer browse/menu → actual cart → checkout quote → order → mock
  PAID → Manager → Kitchen → Rider → COMPLETED; normal, promotion and coupon/Admin paths.
  Test order IDs 1942–1944 existed only in the disposable schema and were removed.
- Demo preservation PASS: all **39 public tables** (37 application + 2 Knex) compared unchanged
  before/after verification. Test-only integration overrides are cleared in the clone to prevent
  accidental live provider calls. Production startup smoke, secret scan and diff check PASS.
- `npm audit --omit=dev`: **0 vulnerabilities**. No dependency added.

Browser limitation: isolated Admin login and Integration page loading were observed. Automation then
stalled at the native confirmation dialog, so save/refresh/clear and desktop/mobile visual acceptance
are **not claimed complete**. The local PostgreSQL process also became unavailable during that
interruption; the existing `npm run start-db` restored it without reinitialization. Only the exact
abandoned QA schema was removed, and migration status/DB verification were checked again. Owner must
finish browser QA after providing the bootstrap encryption key; no real provider tests were run.

Commands: `node scripts/isolated-local-verification.cjs`, `node --test scripts/*.test.cjs`,
`node --test backend/test/deployment-preflight.test.cjs`, `npm run lint`, `npm run build`,
`npm run test:smoke`, `npm run db:status --workspace backend`,
`npm run db:verify-local --workspace backend`, `npm run security:scan`,
`npm audit --omit=dev`, `git diff --check`; migration applied via guarded local `knex.migrate.latest()`.

See [Owner setup/security/deployment guide](docs/ADMIN_INTEGRATION_SETTINGS.md). Runtime provider
configuration is implemented, but real account enrollment, HTTPS and live provider acceptance remain
production prerequisites. Platform PromptPay is NOT wired into merchant payment recipients.
Finance FROZEN; EasySlip real NOT TESTED; LINE real NOT TESTED; Cloud NOT DEPLOYED;
Git NOT COMMITTED / NOT PUSHED.

Files created/changed in this phase (previous uncommitted work preserved):

- `backend/migrations/202610090007_integration_settings.cjs`
- `backend/src/integration-crypto.cjs`, `integration-fields.cjs`, `integration-settings.cjs`, `integration-runtime.cjs`
- `backend/src/config.cjs`, `auth.cjs`, `line-config.cjs`, `app.cjs`, `server.cjs`, `admin-router.cjs`, `admin-service.cjs`
- `backend/scripts/verify-local-db.cjs`, `backend/.env.example`
- `backend/test/integration-settings.integration.test.cjs`, `deployment-preflight.test.cjs`
- `deploy/scripts/deploy-backend.sh`
- `frontend/components/admin-shell.js`, `frontend/app/admin/settings/page.js`
- `frontend/app/admin/settings/integrations/page.js`, `settings.module.css`
- `scripts/isolated-local-verification.cjs`, `scripts/integration-presentation.test.cjs`
- `docs/ADMIN_INTEGRATION_SETTINGS.md`, `README.md`, `DATABASE_SCHEMA.md`, `PROJECT_CONTEXT.md`,
  `DEPLOYMENT_CHECKLIST.md`, `VERIFICATION.md`

## P0 release blockers and final local E2E — 2026-10-09

**PASS for this local release-fix scope; not production provider or Cloud acceptance.**

| Check | Result |
| --- | --- |
| Customer/staff session TTL | PASS; 8 hours, exact boundary, expired/revoked/malformed/nonexistent tokens, re-login; Admin policy unchanged |
| Ubuntu 24.04 Nginx | PASS config-contract checks; IPv4/IPv6 `listen ... ssl http2`; real Linux `nginx -t` NOT RUN |
| Provider-aware deploy preflight | PASS; actual script Node block tested with synthetic EasySlip-only and CheckSlip-only config; missing/invalid config and production mock rejected |
| Production smoke | PASS; stable app markers replace obsolete title assertion; both production processes start |
| Profile/Orders errors | PASS; safe Thai messages, including 401, without raw server messages |
| Full backend suite | **186 PASS, 0 FAIL, 0 SKIP**, including integration, RBAC/IDOR, payment, provider, storage and auth |
| Architecture/presentation suite | **147 PASS, 0 FAIL, 0 SKIP** |
| Root/frontend lint and production build | PASS; 43 routes |
| Customer, payment, promotion, engagement/Admin smoke | PASS in disposable local schema |
| Full local E2E | PASS: browse/menu → actual client cart → quote → order → mock PAID → Manager accept/preparing → Kitchen complete/ready → Manager assign → Rider delivering/completed → customer COMPLETED |
| Migration status / DB verification | PASS; 001–006 complete, pending 0; 36 application tables |
| Production dependency audit | PASS; `npm audit --omit=dev`: 0 vulnerabilities |
| Secret scan / diff whitespace | PASS; existing line-ending conversion warnings only |

`node scripts/isolated-local-verification.cjs` clones the local public schema into a unique
`p0_test_<random>` schema using existing portable PostgreSQL tools. Child processes use only that
schema in `search_path`, mock payment and disabled LINE messaging. Non-local/production targets
are rejected. The schema is removed in `finally`; all **38 public tables** (36 application +
2 Knex metadata) have identical row counts and SHA-256 content digests before/after. No seed/reset
or application migration is performed. Full-run E2E order IDs **1942, 1943, 1944** existed only in
the disposable schema and were cleaned up; normal/promotion/coupon flows all reached COMPLETED.
Browser storage/React hooks are hosted for the real cart module; this is local HTTP API E2E,
not newly completed visual browser/device QA.

Commands: `node scripts/isolated-local-verification.cjs`, `node --test scripts/*.test.cjs`,
`npm run lint`, `npm run build`, `npm run test:smoke`,
`npm run db:status --workspace backend`, `npm run db:verify-local --workspace backend`,
`npm audit --omit=dev`, `npm run security:scan`, `git diff --check`.

Before production: real domain/TLS and rendered `nginx -t`; enrolled provider/account configuration
and manual EasySlip/LINE/private-object-storage checks; Cloud health/reboot checks.
Finance FROZEN. EasySlip real NOT TESTED. LINE real NOT TESTED. Cloud NOT DEPLOYED.
Git NOT COMMITTED / NOT PUSHED. No UI redesign, payment/order business changes or new migration.

## Payment separation / EasySlip v2 — Local implementation, 2026-10-08

Status: **PARTIAL — mock implementation verified; live recipient readiness and browser visual QA pending.**
This does not authorize deployment or change local runtime `.env` from mock.

- Before edits: migrations 001–006 complete, no pending; backend 145/145; frontend lint/build PASS.
- Final automated: backend **177 PASS / 0 FAIL / 0 SKIP** (including **41 payment/EasySlip checks**);
  frontend/presentation/architecture scripts **116 PASS / 0 FAIL**; root lint and production build PASS.
  Mock HTTP smoke with coupon/Admin engagement and separate promotion flow both PASS through
  merchant/KDS/rider COMPLETED; read-only browsing **21 GET checks PASS**.
  Secret/sensitive scan PASS; `git diff --check` PASS (only existing CRLF conversion warnings).
  No live EasySlip/SlipOK verification, deployment, commit or push. Staged files remain zero.
- Dedicated `/orders/[id]/payment`; Order Detail no longer creates attempts/QR or uploads slips.
- Payment UI: one authoritative amount, masked receiver, <=4 MiB JPEG/PNG/WebP picker,
  synchronous submission guard, loading/error/retry/paid states, 1.1s replace redirect;
  focused flow hides shared Bottom Nav only here.
- Local QR retains deterministic amount/CRC. Monetary verification parses decimal THB to
  integer satang, rejecting fractional satang rather than rounding.
- EasySlip tests inject responses or use a loopback HTTP fixture, never real provider network.
  Production mock is forbidden; missing key fails configuration, missing merchant mapping
  fails preflight before storage/provider. Exact registered account AND full raw receiver
  account must match; masked/insufficient evidence is deliberately rejected.
- Same PAID order upload returns the existing safe result without another provider request.
  Global unique transaction reference and one-PAID-payment-per-order remain DB-enforced.
  Transport error retries the same image/attempt; its unique hash is never released.
  Permanent rejection permits a new image/attempt. Provider duplicate with no local PAID
  ledger remains rejected for review, including a verification whose response was lost.
- Real PostgreSQL tests cover ownership, upload MIME/magic/size, amount/receiver/duplicate,
  concurrent uploads, idempotent replay, same-file transport retry and outbox rollback.
  Injected failure after outbox creation proves neither PAID nor notification commits.
- No financial calculation, promotion/coupon formula, order-state machine or migration changed.
  Existing tests create/remove their own Local DB fixtures and restore counters; this is NOT
  a claim of zero test DML. No database reset, truncation or seed rerun was performed.

Remaining gates / limitations:

1. REAL PROVIDER NOT RUN. Verify merchant-to-provider account enrollment and full account
   evidence using the opt-in manual script before selecting live mode. No key was requested
   or inserted. Masked-only account evidence is not accepted; do not weaken to name matching.
2. Actual browser measurements/screenshots at 390x844, 393x852, 430x932, 768x1024 and
   1280x900 are pending. Automated render/CSS contracts are not visual browser acceptance.
3. Historical order choice snapshots do not carry the group/image provenance used by the
   exact Menu/Cart local-demo mapping. They remain unchanged rather than translating real
   merchant snapshots by English labels alone. No schema change was invented for this.
4. Crash/local-finalization failure after provider verification leaves PROCESSING, not PAID.
   It requires operational reconciliation; there is no blind automatic retry or invented
   provider lookup. Do not ask the customer to pay again based only on a timeout.

Files changed in this task (prior unrelated working-tree changes preserved):

- Backend: `src/app.cjs`, `src/config.cjs`, `src/payment-service.cjs`, `src/payment-verifier.cjs`,
  `src/payment-money.cjs`, `src/payment-verifiers/{checkslip-provider,easyslip-provider,mock-provider}.cjs`,
  `scripts/manual-easyslip.cjs`, `.env.example`, `package.json`.
- Frontend: `app/checkout/page.js`, `app/orders/[id]/page.js`,
  `app/orders/[id]/payment/{page.js,payment.module.css}`,
  `components/customer/order-list-card.js`, `lib/payment-presentation.mjs`.
- Tests/scanner: `backend/test/{payment.integration,easyslip-provider}.test.cjs`,
  `scripts/home-presentation.test.cjs`, `scripts/secret-scan.cjs`.
- Docs: `README.md`, `PROJECT_CONTEXT.md`, `VERIFICATION.md`, `DEPLOYMENT_CHECKLIST.md`.

The UI skill's applicable single-column, accessible label/focus, touch-target and async-state
guidance was used; no new global design system or typography direction was introduced.


## Phase J prep status

**READY.** Repository deployment artifacts and the local release gate pass. No Cloud connection,
deployment, firewall change, commit or push was performed. Cloud execution still requires the real
domain/TLS certificate, production database name/user/password and TLS policy, LINE, SlipOK and
private S3-compatible credentials, plus an approved database backup decision.

## Runtime decision

- PM2 7.0.4 and its production dependency chain were removed from `package.json`, lockfile and deploy
  artifacts. Local `dev:frontend`, `dev:backend` and portable PostgreSQL commands are unchanged.
- Ubuntu production uses one native systemd service per application with restart-on-failure,
  start-on-boot, an unprivileged `select-topic-2` account, bounded memory, journald and hardening.
- Secrets live in root-owned `/etc/select-topic-2/backend.env`; the frontend environment is separate.
  Both service units run Node directly, so no extra npm/PM2 supervisor process remains resident.
- HTTP bootstrap and HTTPS Nginx templates preserve `/api/*`, `/api/webhooks/line` and
  `/webhooks/line`. HSTS exists only in the TLS template after a certificate is active.

## Final Phase J gate

| Check | Result |
|---|---|
| Clean `npm ci` from lockfile | PASS |
| Migrations | PASS; 001–006 complete in order, pending 0 |
| Local DB verification | PASS; database `select_topic_2_local`, 36 application tables |
| Backend tests | PASS; 145 tests |
| Architecture tests | PASS; 10 tests |
| Frontend/backend lint | PASS |
| Next.js production build | PASS; 43 generated routes |
| Final/local/production smoke suites | PASS |
| Secret/runtime-artifact scan | PASS; 242 tracked/unignored files, zero findings |
| Bash syntax for all deployment scripts | PASS with Git Bash |
| `git diff --check` | PASS; Windows line-ending notices only |
| `npm audit --omit=dev` | PASS; 0 vulnerabilities |
| Full `npm audit` | WARNING; 5 HIGH in dev-only `eslint-config-next → fast-glob → micromatch → braces` |
| Local health after verification | PASS; frontend 200, backend `ok`, database `ok` |

The full-audit fix proposed by npm is a breaking downgrade to `eslint-config-next@14.2.35`, which is
incompatible with the current Next.js 16 toolchain. No `npm audit fix --force` was run. These packages
are absent from the production-only backend install and are build/lint tooling on the frontend host.

## Deployment safety artifacts

- `backend/scripts/preflight-production-db.cjs` is read-only and refuses targets other than
  `10.0.7.7:5432`, local/test database names and unknown/out-of-order migration history.
- `deploy/scripts/migrate-production.sh` requires an exact target confirmation and a verified backup
  reference when populated tables exist. It never seeds or rolls back.
- `deploy/nginx/select-topic-2-https.conf.template` and `configure-nginx-tls.sh` require a domain and
  readable certificate paths, validate with `nginx -t`, and restore the previous site on failure.
- `.gitignore` covers `.env`, PostgreSQL data, private storage, keys/certificates, `node_modules`,
  `.next`, logs and PID files. Tracked environment files are examples only.
- The complete operator sequence, reboot proof and provider checklist are in
  `DEPLOYMENT_CHECKLIST.md`; the architecture is in `SYSTEM_ARCHITECTURE.md`.

The working tree contains the reviewed application work from Phases E–J and remains intentionally
uncommitted. Proposed commit message: `feat: complete platform management and production readiness`.

---

# Phase I — Final QA & Production Readiness (historical local record, 2026-10-07)

## Outcome

Application QA and local production simulation: **PASS**. Overall production readiness:
**PARTIAL** until real LINE, SlipOK and private object-storage credentials are supplied and their
manual checks pass, HTTPS/network/database operations are provisioned, and the known PM2 dependency
advisory is accepted or remediated by release policy. No Cloud deployment, firewall change, commit or
push was performed.

## Baseline and automated verification

| Check | Result |
|---|---|
| Portable PostgreSQL | PASS; existing `pgdata-v3`, loopback `127.0.0.1:5432`, no reset/reinitialize |
| Migration status | PASS; 001–006 complete, no pending migration; `migrate:latest` already up to date |
| Local DB verification | PASS; 36 application tables |
| Idempotent seed | PASS twice; counts unchanged on rerun |
| `npm run verify` | PASS; lint, 145 backend tests, 8 architecture tests, production build |
| Production build | PASS; 52 App Router page files, including static and dynamic routes |
| `npm run test:smoke:local` | PASS; customer, payment, promotion, merchant/KDS, rider and Admin |
| Merchant management smoke | PASS; 16 tests |
| Customer engagement smoke | PASS; 8 tests |
| `npm run test:smoke:final` | PASS; fresh coupon-to-review/Admin-audit scenario with cleanup |
| Production process smoke | PASS; production guards/config, sanitized DB failure, health and routing |
| Backend and proxied health | PASS; API and database `ok` |
| `git diff --check` | PASS; line-ending notices only |
| Repository secret scan | PASS; 235 tracked/untracked-visible files, zero credential/private-key findings |

## Route, responsive and accessibility QA

- Customer: 11 routes; Merchant: 15 routes; Rider: 3 routes; Admin: 19 routes.
- 288 route/viewport combinations passed at 390×844, 393×852, 430×932, 768×1024,
  1280×900 and 1440×900 with no horizontal page overflow or not-found page.
- The seeded Home banner was rechecked at all six sizes after data refresh; image/API fallback and
  live private image route worked without overflow or alert.
- Fresh browser console after Store and Home navigation: zero errors/warnings. The Store gallery LCP
  warning was removed by eager-loading gallery images.
- Form controls had accessible labels/names, images had meaningful alt text or intentional decorative
  treatment, visible focus styles were present, disabled states were distinct and primary touch targets
  were generally 42–48 px or larger.
- Brand `#AC3520` contrast measured 6.39:1 on white and 5.89:1 on `#FFF3F0`; Noto Sans Thai and the
  existing visual hierarchy remain unchanged.
- Customer favourites now use a semantic page `h1`; no information architecture or business flow changed.

## Fresh business scenario

`test:smoke:final` created a new idempotent order using `WELCOME10`, verified local mock payment,
then completed `PENDING → ACCEPTED → PREPARING → READY → DELIVERING → COMPLETED`. It assigned the
seeded rider, created a 5-star review, generated a current-catalog reorder preview, verified customer
notifications, confirmed Admin order/review visibility, toggled review moderation and found the Admin
audit entries. Test order/payment/slip/notification/redemption/idempotency/audit/session fixtures were
removed and the merchant counter/coupon usage/favourite baseline restored.

## Accounting audit

- Every persisted order satisfies `total = subtotal + delivery fee - discount` (0 mismatches).
- PAID orders without one PAID payment: 0; duplicate PAID payment per order: 0; duplicate non-null
  transaction reference: 0.
- Current local PAID order net total and PAID payment transferred total both equal THB 506.00.
- Admin accounting previously counted PAID but uncompleted orders as revenue. Dashboard/reports/top
  merchants/top items now use the merchant report definition: `COMPLETED + PAID`, net after discount,
  including delivery. A regression test proves a PAID+PENDING order affects payment success but not revenue.
- Payment success remains a payment metric; completed percentage remains an order-state metric.

## Security and production configuration audit

- Customer production access remains LINE/LIFF-only; `liff.isInClient()` is UX gating while backend
  token verification/session authorization is authoritative. Merchant/Rider/Admin browser access is unaffected.
- Customer/staff mock modes and mock payment fail production startup. Admin/customer/staff cookies are
  HTTP-only, Secure in production and SameSite=Lax; Admin mutations also require session CSRF.
- Origin enforcement derives from `APP_PUBLIC_URL`; trusted proxy depth is bounded; request JSON,
  webhook and upload sizes are bounded; MIME and magic bytes are checked.
- Express errors/logs are sanitized. Audit/provider log paths redact secrets and avoid raw slip/provider payloads.
- Next.js and Nginx now send `nosniff`, frame denial, no-referrer and camera/microphone/geolocation denial.
  HSTS is explicitly deferred to the approved HTTPS server block.
- Nginx preserves `/api/*`, `/api/webhooks/line` and `/webhooks/line`; local development now proxies the
  webhook alias as well. PM2 parses both single-instance fork configs with watch disabled.
- `.env`, storage, `.next` and key/certificate patterns are ignored and untracked. Production examples
  contain placeholders only; frontend config has no database or provider secret.

## Demo data

The local-only seed now prepares 3 merchants, 7 categories, 19 menu items, 11 option groups,
26 choices, 5 staff records covering all roles, 9 delivery fees, one published banner, two promotions,
`WELCOME10`, one customer with two addresses, and an idempotent completed order/review. The seed copies
a synthetic PNG banner into ignored local private storage. It refuses non-loopback hosts or a database
other than `select_topic_2_local` and never resets existing orders.

## Provider verification

- LINE manual LIFF/login/webhook/push: **NOT RUN — credentials unavailable**.
- SlipOK real Check Slip: **NOT RUN — credentials unavailable**.
- S3-compatible upload/HEAD/delete: **NOT RUN — credentials unavailable**.
- Automated tests use injected/fake providers and make no real provider calls. Exact manual commands,
  webhook URL and LIFF endpoint are in `DEPLOYMENT_CHECKLIST.md`.

## Dependency audit

`npm audit --omit=dev`: 3 HIGH (`pm2 → chokidar → braces`). Full audit: 7 HIGH because the same
`braces` advisory also propagates through development-only Next ESLint tooling. Installed/latest PM2 is
7.0.4 and still depends on chokidar 3.6.0; npm proposes a breaking downgrade to PM2 2.9.3. No safe
upgrade is currently offered, so no force fix was applied. PM2 watch is disabled, which removes the
application's use of the vulnerable glob-processing path. A zero-HIGH release policy still needs an
explicit risk acceptance or replacement process manager.

## Limitations by category

**Deployment blockers**

- Production secrets/provider accounts and real LINE/SlipOK/object-storage manual checks are pending.
- Public domain, TLS certificate/HSTS, Cloud network rules, PostgreSQL TLS/backup/restore and PM2 reboot
  checks require the target environment and deployment authorization.
- The PM2 advisory requires release-policy disposition if HIGH findings are prohibited.

**Demo/local limitations**

- Local credentials, mock LINE/payment and demo bank/store/customer data are synthetic only.
- Historical PostgreSQL shutdown cause remains unproven; idempotent start/stop/status scripts and current
  health are stable, but production must use managed/service supervision and monitoring.

**Future enhancements**

- Order chat business logic/UI, refund automation, automatic stock reservation/decrement and expanded
  pickup completion remain deferred.
- Login throttling is process-local; add edge/shared rate limiting before multi-instance scale-out.
- Durable customer/staff sessions, formal retention schedules and orphan-upload cleanup can be added
  without changing the verified business state machines.

## Phase I files

- QA/runtime: `scripts/payment-smoke.cjs`, `scripts/architecture.test.cjs`, `package.json`,
  `backend/test/admin-backoffice.integration.test.cjs`.
- Accounting/security: `backend/src/admin-service.cjs`, Admin dashboard/reports pages,
  `frontend/next.config.mjs`, `deploy/nginx/select-topic-2.conf`.
- UI polish: Store gallery loading, semantic favourites heading, Home heading selector and Admin
  promotion copy.
- Demo: `backend/seeds/001_local_development.cjs`, `backend/seeds/assets/local-demo-banner.png`.
- Docs: `README.md`, `PROJECT_CONTEXT.md`, `DATABASE_SCHEMA.md`, `VERIFICATION.md`,
  `SYSTEM_ARCHITECTURE.md`, `DEPLOYMENT_CHECKLIST.md`, `DEMO_SCRIPT.md`.

---

# Phase G — Merchant Professional Management (Local; final check 2026-10-07)

Implementation G1–G11 complete. Overall verification PARTIAL only for automated browser file upload:
filechooser timed out; synthetic PNG upload succeeded through local HTTP and PAID was confirmed in UI.
All other requested local checks passed except the known npm audit HIGH advisory (not fixed).
No Cloud/firewall/commit/push. No edits to migrations 001–004. Prior Phase E/F changes retained.

| Check | Result |
|---|---|
| Baseline gate before implementation | PASS: 117 backend + 8 architecture/banner, lint/build, all local smoke |
| Additive migration 005 | PASS: applied batch 5; merchant_opening_hours only |
| db:status / db:verify-local | PASS: 001–005 complete, no pending, 31 application tables |
| npm run verify (final backend/architecture/lint/build) | PASS: 135 backend tests, 8 architecture/banner tests |
| npm run test:smoke:merchant-management | PASS: 16 tests including last-manager and rider assignment concurrency |
| Frontend lint + production build after final CSS | PASS |
| npm run test:smoke:local | PASS: browsing/profile/address; ordinary and discounted full paid-to-completed pipeline; admin |
| npm run test:smoke | PASS: production backend config/startup and sanitized DB failure; frontend page/health |
| Browser management and state flow | PASS: menu/category/options/staff/rider/fees/report; customer→order→merchant→rider→COMPLETED |
| Browser file upload | BLOCKED by automation filechooser; local HTTP upload verified separately |
| Responsive final | PASS: 13 pages × 5 widths (390,430,768,1280,1440), 65 cases, no document overflow |
| Browser console after image sizing correction | PASS: no new errors/warnings |
| npm audit --omit=dev | KNOWN FAIL: 3 HIGH packages, PM2→chokidar→braces |
| npm audit (full) | KNOWN FAIL: 7 HIGH including dev ESLint chain; same underlying advisory |
| git diff --check | PASS (line-ending notices only) |

Commands executed: npm run start-db; npm run status-db; npm run db:migrate --workspace backend;
npm run db:status --workspace backend; npm run db:verify-local --workspace backend;
node --test backend/test/merchant-management.integration.test.cjs after every milestone;
node --test --test-concurrency=1 (management, opening-hours, slip-object-storage suites);
npm run verify; npm run lint; npm run build; npm run test:smoke:merchant-management;
npm run test:smoke:local; npm run test:smoke; npm audit --omit=dev --json; npm audit --json;
git diff --check. Prettier 3.6.2 was invoked as a one-off formatter; no project dependency added.
No seed rerun/reset. No real provider HTTP verification.

Final service recheck found all three local processes stopped; restarted the same existing portable
PostgreSQL/data directory with npm run start-db, then existing Node watch/Next dev commands in hidden
background processes. No reinitialization. Final loopback listeners: PostgreSQL 5432 (PID 41840),
backend 3001 (PID 22328), frontend 3000 (PID 43592). Backend health API/database both ok;
GET http://127.0.0.1:3000/merchant returned 200. This observation does not identify why prior processes stopped.

Evidence logs are ignored `.phase-g-*.log`; UI screenshots and responsive JSON are in ignored
`backend/storage/browser-test/`. Order LOC-000006/id808 is retained COMPLETED/PAID (net 132 THB).
Browser fixtures Phase G Demo category/menu, Demo Egg choice, demo rider, and one-use exhausted
promotion remain for local review. Previous seed/history/counters were not reset or deleted.
See database/PHASE_G_REPORT.md for full route/policy/files/limitations and stock Phase H analysis.

---
# Phase F — Production Stability + Business Completion (Local, 2026-10-06)

## Outcome

Local functional verification PASS. Production readiness remains conditional on the unresolved
upstream dependency advisory and observing PostgreSQL stability outside this test session.
No Cloud deployment, firewall change, commit or push. Existing migration files 001/002/003
were not edited. The user explicitly approved additive 004 and quota policy before implementation.

## F1 PostgreSQL findings and management

- Source of truth: ignored backend/.env; DB select_topic_2_local at 127.0.0.1:5432.
- Reused %LOCALAPPDATA%/select-topic-2/pgdata-v3 and PostgreSQL 16.15 from
  postgresql-16.15-tar/pgsql/bin. No initdb/reset/data or lock-file deletion.
- Logs show interrupted/unclean shutdowns before 2026-10-05 23:24 and 23:56 Bangkok
  restarts, followed by successful WAL recovery and readiness. They do not identify a killer.
  Client-connection reset messages are not evidence that the server exited.
- Windows Application error search found no postgres/pg_ctl crash entry in the inspected
  two-day window. System search found no matching 2004 resource exhaustion / 41 / 6008 events.
  Security 4689 process-exit query returned no matching events. Historical exit cause is UNKNOWN;
  an IDE/terminal job lifetime is a hypothesis, not a confirmed diagnosis.
- Current machine checks: roughly 159 GB free disk, 11 GB free RAM; no conflicting 5432 listener.
  These snapshots do not prove historical resource availability. Existing server was still running
  from the previous hidden launch when this phase began (more than an hour).
- Added npm run start-db / stop-db / status-db using scripts/local-db.ps1. Named mutex;
  binary/version/PID/data-directory validation; occupied-port refusal; loopback-only check;
  hidden pg_ctl startup and native process-handle exit wait; pg_isready; graceful fast stop;
  timestamped successful management events outside the repository.
- Verified stop twice, start twice (same PID on repeated start), TCP True, loopback listener,
  and backend auto-reconnection without restarting the application. During script development,
  Windows PowerShell initially returned a null ExitCode; caching the native process handle fixed it.
- Run from a normal terminal for lifetime independent of IDE execution. No Windows service,
  scheduled task, or automatic crash restart was installed. Use the graceful stop command.

## F2 Dependency security audit

Audit after changes: full npm audit = 7 HIGH; npm audit --omit=dev = 3 HIGH.
These are dependency propagation findings, not seven independent vulnerabilities.

| Package | Installed / chain | Exposure | Patch / path |
| --- | --- | --- | --- |
| braces | 3.0.3, PM2 → chokidar → braces | Deeply nested brace patterns can exhaust stack | No patched release published in checked advisory/registry |
| chokidar | 3.6.0 under PM2 7.0.4 | PM2 file-watch patterns; watcher disabled in both production configs | PM2 latest 7.0.4 still pins 3.6.0; forcing chokidar 4/5 breaks glob API |
| pm2 | 7.0.4 root runtime tool | Does not receive customer HTTP payloads as watch patterns | No compatible upstream fix currently available |

Development chain also affected: eslint-config-next 16.3.8 → @next/eslint-plugin-next →
fast-glob 3.3.1 → micromatch 4.0.8 → braces 3.0.3. Lint uses repository-controlled paths.
Source inspection of PM2/lib/Watcher.js confirmed chokidar is used by watch mode. Explicit
watch:false plus regression assertion was added to both PM2 configs. This reduces exposure;
it does not remove the vulnerable installed dependency or make npm audit pass.
Do not accept audit's breaking downgrade to PM2 2.9.3 / eslint-config-next 14.2.35.
Safe path: a compatible patched braces release plus lockfile update, or an upstream PM2/Next
release with compatible dependencies; then repeat regression. No force-fix or unreviewed override.

Source: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Registry commands: npm view pm2 version dependencies.chokidar; npm view braces version;
npm ls pm2 chokidar braces. No dependency versions or lockfile changed in Phase F.

## F3 Suspension policy

- Browse/detail keep a suspended merchant visible with is_active=false,
  accepting_orders=false and unavailable_reason=merchant_suspended; no private suspension reason.
- Menu add button and checkout confirmation are disabled. The backend quote and POST /api/orders
  independently reject with HTTP 409 merchant_suspended, including bypassed UI.
- Order creation holds the existing merchant FOR UPDATE lock. Admin status UPDATE obtains the
  same row lock, so concurrent suspension/new-order transactions serialize. An order committed
  before suspension is historical and remains valid.
- Active staff may still log in and view/fulfill existing orders, including KDS/rider work;
  existing customer history/payment remains available. Suspension does not masquerade as is_open.
- Activation reopens eligibility immediately, still subject to normal is_open/menu/address rules.
  Suspend/activate retain their transactional Admin audit events.

## F4 Promotion engine and approved schema

Migration 202610060004_promotion_checkout.cjs applied as batch 4. Four complete, zero pending,
30 application tables. Adds orders.promotion_id, promotion_snapshot JSONB, discount_amount
(default 0), revised total constraint and promotion_redemptions with UNIQUE order_id / FKs.
Prior orders remain unchanged at discount 0. Rollback refuses to erase used snapshots.

- One promotion per order, global or merchant-scoped; percentage/fixed amount on food subtotal
  including options; free delivery on delivery fee; minimum spend excludes fee.
- Amounts converted to integer satang; percentage uses BigInt basis points and half-up rounding.
  Discount is capped at applicable base and maximum_discount_amount when present.
- DB clock checks start/end, active/deleted status, merchant eligibility and usage limit.
- Merchant then promotion row locks; order, redemption, quota increment and idempotency completion
  commit together. Errors roll back all; quotes consume nothing; repeated/restarted requests
  with the same key reuse the stored result without another redemption.
- Quota is consumed at order creation and is NOT automatically restored on rejection/cancellation.
  Admin updates lock the promotion and cannot reduce limit below consumed count.
- POST /api/orders/quote; GET /api/promotions?merchantId=...; GET /api/promotions/:id all require
  customer session. Checkout displays server quote; create revalidates prices/rules independently.
  Customer and merchant receipts use immutable promotion snapshot and discount.
- A promotion yielding zero payable total is explicitly rejected (promotion_zero_total_unsupported),
  rather than inventing zero-payment fulfillment or marking it PAID. This is a remaining policy/flow limitation.

Examples (food 200.00 + fee 15.00):

| Promotion | Discount | Payable |
| --- | --- | --- |
| 10% | 20.00 | 195.00 |
| Fixed 30 | 30.00 | 185.00 |
| Free delivery | 15.00 | 200.00 |
| 50%, max 25 | 25.00 | 190.00 |

Browser example: food 60 + fee 15 - 10% (6) = 69, verified from backend quote.

## F5 Banner integration

Only PUBLISHED, non-deleted banners within [starts_at, ends_at) are public, sorted by
sort_order then id. Future PUBLISHED entries automatically become visible at start time.
DRAFT/SCHEDULED/ARCHIVED do not appear; SCHEDULED is preparation state until Admin publishes.
Home retains its single-banner layout and shows the first eligible item. Empty/failing API
uses the original banner; failed image also restores original content/CTA. Image delivery
remains through backend/private storage with visibility checked on each request.
STORE/MENU map to detail pages, PROMOTION to new /promotions/[id], URL permits safe relative
or HTTPS destinations only. Promotion details explain that selection happens at checkout.

## Verification

| Check | Result |
| --- | --- |
| start-db, stop-db, status-db; repeated operations; backend reconnect | PASS |
| db:migrate; db:status; db:verify-local | PASS, 001–004 complete; 30 tables |
| npm run verify | PASS: backend 117, architecture/banner 8, lint, production build |
| npm run test:smoke | PASS: production startup, health, proxy assumptions |
| npm run test:smoke:local | PASS: browsing, ordinary pipeline, discounted pipeline, Admin |
| Customer → PAID → merchant/KDS → rider → COMPLETED | PASS with and without promotion |
| Browser Home → promotion CTA/detail → checkout selection/quote | PASS; captured console errors/warnings 0 |
| Home fallback after fixture cleanup | PASS |
| npm audit / npm audit --omit=dev | WARNING / NOT CLEAN: 7 HIGH / 3 HIGH |

New tests cover integer rounding/caps, minimum, inactive/future/expired/wrong merchant,
free-delivery/PICKUP restriction, zero-pay guard, cross-merchant global quota concurrency,
replay across recreated app, rollback, immutable snapshots, suspension/bypass/history/staff
access/reactivation/audit, banner publication/window/sort/private images and safe targets.
Fixtures/orders/payment/slips/redemptions/provider test artifacts are cleaned by their test
workflows. Browser fixture promotion/banner/object removed; no order was created through the
browser and the existing user cart was preserved. Automated tests call no real provider.

## Files added/changed in Phase F

- New: scripts/local-db.ps1; backend/migrations/202610060004_promotion_checkout.cjs;
  backend/src/promotion-service.cjs; backend/test/phase-f.integration.test.cjs;
  frontend/lib/banner-target.mjs; frontend/app/promotions/[id]/page.js;
  scripts/banner-target.test.cjs.
- Backend: src/order-service.cjs, store-repository.cjs, merchant-order-service.cjs, app.cjs,
  admin-service.cjs; scripts/verify-local-db.cjs; test/admin-backoffice.integration.test.cjs.
- Frontend: app/checkout/page.js, app/orders/[id]/page.js, app/merchant/orders/[id]/page.js,
  app/stores/[id]/page.js, app/menu/[id]/page.js; components/home/store-card.js,
  components/home/promo-banner.js, components/admin-resource-page.js.
- Operations/tests/docs: package.json; deploy/pm2/{frontend,backend}.ecosystem.config.cjs;
  scripts/architecture.test.cjs, scripts/payment-smoke.cjs; deploy/local/README.md;
  README.md, DATABASE_SCHEMA.md, VERIFICATION.md.
- The working tree also contains the pre-existing uncommitted Phase E changes; they are preserved.

## Remaining blockers / limitations

Upstream HIGH advisory remains unpatched; PostgreSQL historical exit cause cannot be proven
from available logs; zero-pay checkout requires an explicit later payment/fulfillment policy.
Real LINE/SlipOK/S3 credentials/manual verification and other prior production provisioning
checks remain outside this Local phase. No new real-provider calls or Cloud actions occurred.

---

# Phase E — local verification 2026-10-05

## Status

Local environment: PASS. Admin Backoffice E1–E10 implementation and automated
verification: PASS, with the business-policy and operational limitations below.
Overall Phase E: PARTIAL because merchant suspension enforcement in the existing
ordering flow requires a separate policy decision, and this phase does not change that flow.
No Cloud deployment, firewall changes, commit or push were performed.

## Database recovery and baseline

- Source of truth: ignored `backend/.env`, loopback `127.0.0.1:5432`,
  database `select_topic_2_local`.
- Binary: `%LOCALAPPDATA%/select-topic-2/postgresql-16.15-tar/pgsql/bin/pg_ctl.exe`.
- Reused `%LOCALAPPDATA%/select-topic-2/pgdata-v3`; no initdb, reset or data-directory deletion.
- The incomplete `postgresql-16.15` extraction was not used after its missing timezone-file error.
- PostgreSQL was started with `-h 127.0.0.1 -p 5432`; TCP check returned True.
- Baseline before implementation: migrations 001/002 complete, no pending migrations,
  23 tables verified, 99 backend tests, 7 architecture tests, lint and production build passed.
- Subsequent checks twice found local PostgreSQL stopped without a shutdown explanation in
  the inspected log. A verification attempt failed with ECONNREFUSED. The final recovery
  launched the same pg_ctl through a hidden Windows process, restarted the dev servers,
  and reran the full verify and smoke suites successfully. Final TCP and both health
  endpoints passed. The earlier process exits are not yet explained; no new cluster was created.

## Additive schema

`202610050003_admin_backoffice.cjs` was applied as batch 3. Earlier migrations 001/002
have no Git diff. Three migrations complete, zero pending, 29 application tables.

New tables: `platform_admins`, `platform_admin_sessions`, `audit_logs`, `banners`,
`promotions`, `system_settings`.

Merchant additions: `is_active`, `suspended_at`, `suspension_reason`,
`suspended_by_admin_id`. Suspension metadata is distinct from `is_open`.
Indexes cover admin identity/role, session token/expiry, audit actor/action/entity/time,
banner/promotion visibility, merchant status, and order/payment reporting by status/date.

## Admin scope delivered

| Milestone | Implementation |
| --- | --- |
| E1 | Separate Admin login/session, bcrypt 12, backend RBAC, per-session CSRF, append-only audit |
| E2 | Dashboard with database aggregates, status counts and recent orders |
| E3 | Merchant/customer search/detail/status management; masked PromptPay; restricted LINE identity |
| E4 | Global orders/payment views, filters, snapshot detail, masked references, verification history |
| E5 | Create/edit/soft-deactivate sois and dormitories; delivery coverage counts |
| E6 | Banner upload/preview/edit/schedule/publish/archive/reorder; private storage; Home fallback |
| E7 | Promotion management, validation, active/upcoming/expired/disabled views |
| E8 | Admin creation/edit/roles/password reset/activation; serialized last-super protection |
| E9 | Safe system status, queues, allowlisted non-secret settings |
| E10 | SQL-based order/revenue/average/status percentages and top merchants/items |

Frontend routes: `/admin/login`, `/admin`, `/admin/merchants`, `/admin/merchants/[id]`,
`/admin/customers`, `/admin/customers/[id]`, `/admin/orders`, `/admin/orders/[id]`,
`/admin/payments`, `/admin/payments/[id]`, `/admin/delivery-areas`, `/admin/banners`,
`/admin/promotions`, `/admin/users`, `/admin/audit-logs`, `/admin/system-status`,
`/admin/settings`, `/admin/reports`.

APIs live under `/api/admin/*`; public banner routes are `/api/banners/active` and
`/api/banners/:id/image`. Published/scheduled banners are exposed only inside their
visibility window. Draft preview requires Admin content permission. Images are served
through the backend storage interface; the bucket stays private and DB stores object keys.

## Security and role policy

- SUPER_ADMIN: all implemented Admin operations, including merchant suspension and Admin users.
- ADMIN: management of customers/content/areas, read merchant/order/payment, status/reports/audit.
- SUPPORT: merchant/customer/order/payment reads; no LINE identity field, payment slip/provider detail,
  or sensitive audit metadata. Audit access is limited to the user's own events.
- FINANCE: dashboard, order/payment/verification views and reports; no merchant/content/settings writes.
- All mutations enforce backend RBAC and session-specific CSRF. Session tokens are random,
  stored as SHA-256 hashes, regenerated after login, revoked at logout and sensitive account changes.
- Cookie: HttpOnly Admin session, SameSite=Lax, Secure in production. Lifetime 10 hours,
  idle timeout 30 minutes. Customer/staff cookies cannot authenticate Admin endpoints.
- Admin updates serialize with a PostgreSQL transaction advisory lock so concurrent changes
  cannot remove the final active SUPER_ADMIN. Audit writes share management transactions.
- Passwords are bcrypt cost 12, with a 72-byte limit. Local synthetic seed is DEV ONLY.

## Verification results

| Command / check | Result |
| --- | --- |
| `npm run db:migrate --workspace backend` | PASS; already up to date after applying 003 |
| `npm run db:status --workspace backend` | PASS; 001/002/003 complete, no pending |
| `npm run db:seed --workspace backend` | PASS; idempotent local-only seed, one synthetic SUPER_ADMIN |
| `npm run db:verify-local --workspace backend` | PASS; 29 application tables and expected seed |
| `npm run verify` | PASS; lint, backend 110 tests, architecture 7 tests, production build |
| `npm run test:smoke` | PASS; production startup/health/proxy assumptions |
| `npm run test:smoke:local` | PASS; customer browsing, PAID → READY → DELIVERING → COMPLETED, Admin |
| `npm run test:smoke:admin` | PASS; login, global views, status/reports, logout |
| Browser Admin login and 13 pages at 390/768/1280/1440 | PASS; 52 route/viewport checks, no page overflow |
| Mobile banner/promotion/Admin editor forms | PASS; no horizontal page overflow |
| Browser console | 0 errors / warnings captured |
| Backend `/api/health` | HTTP 200; API and database `ok` |
| Frontend `/health` | HTTP 200; frontend `ok` |
| `git diff --check` | PASS |
| `npm audit --omit=dev` | WARNING; 3 high advisories through braces → chokidar → PM2 |

Automated tests never call real LINE, SlipOK or S3 providers. Smoke/integration fixtures
are cleaned up; pre-existing local orders and database files are preserved.

## Known limitations and deferred work

1. Merchant suspension currently records central management state and audit only. Enforcing it
   in browsing/checkout/staff operations would change existing business flow. Proposed next policy:
   prevent new checkout for suspended merchants while preserving payment and fulfillment of existing
   orders; confirm this separately before changing those services.
2. Automatic promotion checkout and customer promotion discovery are implemented. Coupon and
   promotion stacking remains intentionally disabled (`AUTO PROMOTION XOR COUPON`).
3. E11 merchant menu/staff/rider/store settings/report enhancements are deferred as Phase E2.
4. Durable `order_status_events` is deferred; order detail shows existing lifecycle timestamps.
   There is no arbitrary order-state override, payment override, refund automation or impersonation.
5. Login rate limit is process-local; add a shared/edge limiter before multi-instance production.
   Admin session/audit retention and orphaned banner-upload cleanup still need operational policy.
6. Real provider credentials/manual checks and production Admin provisioning are not part of this
   local verification. Production seed is intentionally blocked.
7. Existing PM2 dependency audit findings need a reviewed remediation. No forced PM2 downgrade
   or unrelated dependency update was performed in this phase.

## Changed files

- Database: additive `backend/migrations/202610050003_admin_backoffice.cjs`,
  `backend/seeds/001_local_development.cjs`, `backend/scripts/verify-local-db.cjs`.
- Backend: new `backend/src/admin-{audit,auth,router,service}.cjs`; wiring in
  `backend/src/app.cjs`, `backend/src/server.cjs`; private banner operations in
  `backend/src/slip-storage.cjs`.
- Frontend: 19 route/layout files under `frontend/app/admin/`; new
  `frontend/components/admin-{shell,resource-page,editor,content-manager}.js` and
  `frontend/lib/use-admin.js`; updates to `frontend/app/globals.css`,
  `frontend/app/page.js`, `frontend/components/home/promo-banner.js`,
  `frontend/lib/customer-access-policy.mjs`.
- Verification: `backend/test/admin-backoffice.integration.test.cjs`,
  `backend/test/migration.test.cjs`, `backend/test/slip-object-storage.test.cjs`,
  `scripts/admin-smoke.cjs`, `scripts/architecture.test.cjs`, root `package.json`.
- Documentation: `README.md`, `DATABASE_SCHEMA.md`, `PROJECT_CONTEXT.md`,
  `deploy/local/README.md`, `VERIFICATION.md`.

## Previous verification history

# LINE Integration — local verification 2026-10-02

Scope: LIFF initialization, LINE Login ID-token verification, Messaging API abstraction,
Flex Messages, webhook signature validation and order-event notifications. No Cloud
deployment, firewall, Git commit/push, real CheckSlip, refund, chat, reviews or banners.

## Schema decision

Customer and staff LINE identities use the canonical `line_user_id` columns. The later additive
production-hardening migration adds durable webhook event deduplication and a transactional
notification outbox. OA relationship state is still intentionally not stored.

## Authentication and LIFF

`POST /api/auth/line` accepts an LIFF ID token only. The backend submits it to LINE's
token verification endpoint with `LINE_CHANNEL_ID`, then independently checks issuer,
expiry, audience and verified `sub`. Any `line_user_id` or `userId` supplied by the
frontend is ignored. Existing customers are matched by verified `sub`; a new identity
creates a customer and returns `onboarding_required=true` until phone/address exist.

The frontend loads the official LIFF SDK only when `/api/auth/config` reports line mode:

```text
liff.init -> liff.login when needed -> getIDToken -> POST /api/auth/line
-> HTTP-only server session
```

Mock development mode continues to use the synthetic seeded customer and never loads
the LIFF SDK.

## Messaging and Flex events

`LINE_MESSAGING_MODE` supports `disabled`, `mock` and `real`. Tests inject a fake
provider; they never call LINE. Flex builders cover:

- `PAYMENT_VERIFIED`
- `ORDER_ACCEPTED`
- `PREPARING`
- `READY`
- `DELIVERING`
- `COMPLETED`
- `REJECTED`

Each notification includes order code, store, current event/status and an order-status
CTA. Payment provider and slip internals are excluded. Notifications run only after the
database transaction commits. Provider failure is safely logged by event/order/error
code and never rolls back payment or order state.

## Webhook

`POST /api/webhooks/line` and the legacy proxy-compatible `/webhooks/line` read the raw
request body before JSON parsing and verify `x-line-signature` with HMAC-SHA256 and a
timing-safe comparison. Invalid signatures return 401. Valid follow/unfollow/postback
events are accepted; duplicate `webhookEventId` values are ignored in-process.

## Verification results

| Check | Result |
| --- | --- |
| `npm run verify` | PASS |
| Backend tests/subtests | 68 PASS |
| Architecture tests | 4 PASS |
| Production frontend build | PASS |
| `npm run test:smoke` | PASS; unsigned webhook returns 401 |
| `npm run test:smoke:local` | PASS; mock customer through COMPLETED |
| Real LINE HTTP calls in tests | 0 |

Security coverage includes invalid token, wrong audience, spoofed identity fields,
production mock guards, invalid/valid webhook signatures and sanitized Messaging API
errors. Notification coverage includes all seven events, duplicate suppression and both
payment and merchant transaction survival when LINE fails.

## Credentials still required for manual LIFF verification

- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET` or `LINE_WEBHOOK_SECRET`
- `LINE_LIFF_ID`
- `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
- Public HTTPS LIFF endpoint and registered webhook URL

No real values are stored in the repository.

# Phase H customer engagement — local verification 2026-10-07

Scope: reviews/ratings, favourites, reorder preview, coupon checkout, promotion discovery,
provider-independent notification history, small Home personalization, Admin moderation/coupon
management and Merchant review visibility. No Cloud deployment, commit or push was performed.

## Schema and database

| Check | Result |
| --- | --- |
| Portable PostgreSQL | PASS; `127.0.0.1:5432`, `select_topic_2_local`, PID 41840 during verification |
| Migration status | PASS; 001–006 complete, no pending migration |
| Migration 006 | PASS; additive only, five tables plus nullable order coupon snapshot fields |
| Local DB verification | PASS; 36 application tables and expected development seed |
| Seed | `WELCOME10` coupon plus an active free-delivery promotion; local-only guard retained |

## Automated verification

| Command / check | Result |
| --- | --- |
| `npm run verify` | PASS |
| Backend | 144 tests PASS |
| Architecture/browser policy | 8 tests PASS |
| Phase H targeted suite | 8 tests PASS |
| Production frontend build | PASS; 43 routes |
| `npm run test:smoke:local` | PASS; customer/payment/promotion/merchant/kitchen/rider/Admin |
| `npm run test:smoke:merchant-management` | PASS; 16 tests |
| `npm run test:smoke:admin` | PASS |
| `npm run test:smoke` | PASS; backend/frontend production startup smoke |
| Backend health | HTTP 200; API and database `ok` |
| Frontend health | HTTP 200 |
| Responsive | PASS at 390, 393, 430, 768 and 1280; no horizontal overflow |
| Fresh browser console | 0 errors / warnings after customer Home loaded |

Targeted Phase H coverage includes review ownership/completion/uniqueness/rating/aggregate; favourite
idempotency and isolation; current-price reorder with unavailable options and suspension; percentage,
fixed and free-delivery coupons; inactive/future/expired/scope/minimum/zero-total checks; global and
per-customer quota, concurrent redemption and replay; notification dedupe/read/isolation; Admin audit.

## Browser flow

PASS: customer favourite → menu/cart/checkout with `WELCOME10` → payment verified → Manager accept →
PREPARING → KDS complete → READY → rider assignment → DELIVERING → COMPLETED → 5-star review →
reorder to current cart. Admin displayed the review, hide/publish worked, coupon usage was 1 and order
detail retained the coupon snapshot. Home then displayed `5.0 (1 รีวิว)`, the favourite store, active
promotion, recent order and six durable notifications; read-all reduced unread to zero. Merchant review
view displayed the published review read-only.

## Audit

`npm audit --omit=dev` reports the known 3 HIGH findings in `braces → chokidar → pm2`.
Full `npm audit` reports 7 HIGH because the same `braces` advisory also reaches development lint
packages. npm proposes a breaking PM2 downgrade through `--force`; it was intentionally not applied.
# Demo encryption key UX — 2026-10-09

Status: **PASS**. This update supersedes the earlier manual-bootstrap-key blocker for local/demo.

- ENV encryption key retains highest priority. Development/local without it creates and reuses
  `backend/.runtime/integration-settings.key`, outside Git. Atomic publish avoids concurrent first-boot
  overwrite. POSIX creation uses 600/700; Windows file ACL allows current user and SYSTEM only.
- Production never generates keys: ENV or a provisioned absolute `INTEGRATION_SETTINGS_KEY_FILE`.
  Corrupt/unreadable files fail closed; existing ciphertext requires its original key. No automatic
  rotation, plaintext secret storage, schema/RBAC/provider/payment/Finance changes.
- Admin UI shows encryption readiness and system-managed development key status without key/path.
  Live local authenticated GET returned 200, `encryption_ready=true`, `DEVELOPMENT_FILE`; test session
  logged out. No live integration values were changed and no real provider calls were made.

| Verification | Result |
| --- | --- |
| `node scripts/isolated-local-verification.cjs` (existing portable PostgreSQL bin) | **209 backend tests PASS, 0 FAIL, 0 SKIP**; browsing, payment, promotion, Phase I and Admin smoke PASS |
| Demo preservation | **39 public tables unchanged** during isolated regression; disposable schema removed |
| `node --test scripts/*.test.cjs` | **151 PASS, 0 FAIL, 0 SKIP**, frontend presentation and architecture |
| `npm run lint` | PASS |
| `npm run build` | PASS; 44 generated pages |
| `npm run security:scan` | PASS; no credential/runtime findings |
| `git diff --check` | PASS; only existing line-ending conversion notices |

New tests cover persistent first boot, separate-process restart/decryption, concurrent publication,
ENV precedence, production no-generation/provisioned-file behavior, corrupted keys, safe API and
logs/audit, actual isolated DB save/reload, Git ignore and UI readiness/disabled fallback.

Files changed for this increment: `.gitignore`, `backend/.env.example`, `backend/.env.local.example`,
`backend/src/integration-key.cjs` (new), `backend/src/integration-settings.cjs`,
`backend/test/integration-key.test.cjs` (new), `backend/test/integration-settings.integration.test.cjs`,
`frontend/app/admin/settings/integrations/page.js`, `scripts/integration-presentation.test.cjs`,
`scripts/secret-scan.cjs`, `README.md`, `PROJECT_CONTEXT.md`, `docs/ADMIN_INTEGRATION_SETTINGS.md`,
and this verification record. The generated local runtime key is ignored and never displayed.

No deploy, commit or push. No Finance implementation. Preserve the key with a private backup;
deleting/replacing it makes dependent encrypted settings unreadable.

## Integration Settings manual save QA fix — 2026-10-09

INTEGRATION SETTINGS MANUAL QA FIX STATUS: **PASS**

Root causes found: section action buttons lacked styles after CSS reset; native browser confirmation
stalled in the in-app browser before PATCH. This does not establish why an earlier Owner attempt
lost values, but both observed UX blockers are resolved. No API/resolver persistence defect was
found. Six section saves were verified through browser clicks, server validation, PostgreSQL,
success response and reload, not inferred from render tests.

- Scoped Admin primary/secondary/clear button styles include border/background, hover, focus,
  disabled and loading states. A labelled HTML dialog replaces native confirmation on this page.
- Synchronous in-flight guard prevents duplicate save/test requests. Submitted secrets clear from
  inputs immediately. Successful save uses the server's masked response and retains unrelated drafts.
- Thai success/error feedback is placed under the active section. Existing Platform PromptPay
  warning and unwired merchant-recipient boundary remain intact.

| Check | Result |
| --- | --- |
| Save buttons visible | YES — desktop 1280×900 and mobile 430×932 |
| Payment provider/enabled save + refresh | PASS — checkslip and disabled persisted in isolated fixture |
| Platform PromptPay save + refresh | PASS — synthetic name and masked identifier; no cutover |
| EasySlip save + refresh | PASS — configured state; fixed Base URL unchanged |
| CheckSlip save + refresh | PASS — synthetic URL/key |
| LINE Login save + refresh | PASS — synthetic channel/LIFF IDs |
| Messaging save + refresh | PASS — mock mode, webhook disabled and configured secrets |
| Synthetic secret masking | PASS — no plaintext GET; password inputs empty; blank preserve; explicit clear |
| EasySlip account action | PASS with fake GET /v2/info; no real provider network call |
| Validation error / confirm / cancel | PASS — friendly message; failed update preserves saved value |
| Horizontal overflow | NONE — document scrollWidth equals clientWidth at both viewports |
| Console | No warning/error on successful flows; intentional invalid-input test returned expected HTTP 400 |
| Backend full tests | **210 PASS, 0 FAIL, 0 SKIP** |
| Frontend / architecture / presentation | **155 PASS, 0 FAIL, 0 SKIP** |
| Lint / production build | PASS; 44 generated pages |
| Secret scan / git diff --check | PASS |

Commands: node scripts/isolated-local-verification.cjs (existing portable PostgreSQL bin),
node --test scripts/*.test.cjs, npm run lint, npm run build, npm run security:scan,
git -c core.safecrlf=false diff --check. Browser testing used an ignored temporary proxy/fixture
serving the compiled frontend against the disposable schema; fixture services were stopped afterward.

Full backend/regression run confirmed all 39 public tables unchanged. During the separate longer
browser session the strict public-data fingerprint check reported a change in platform_admin_sessions
(same 12 rows; active session metadata changed while the normal local server remained running).
The fixture used its own search_path and all test schemas were removed. No public integration
settings, demo data or session metadata were restored/overwritten to hide this warning. The browser
fixture separately verified encrypted DB storage and no synthetic secrets in audit logs before cleanup.

Files changed in this increment:
- frontend/app/admin/settings/integrations/page.js
- frontend/app/admin/settings/integrations/settings.module.css
- scripts/integration-presentation.test.cjs
- backend/test/integration-settings.integration.test.cjs
- docs/ADMIN_INTEGRATION_SETTINGS.md
- VERIFICATION.md

Application/payment/provider/recipient logic: **UNCHANGED**. Finance: **UNCHANGED**.
Schema and Admin RBAC: **UNCHANGED**. Cloud: **NOT DEPLOYED**. Git: **NOT COMMITTED / NOT PUSHED**.

## EasySlip account test feedback fix — 2026-10-09

EASYSLIP ACCOUNT TEST UX STATUS: **PASS**

Audit: the existing click opens confirmation, then POSTs to
/api/admin/settings/integrations/test-easyslip. The backend already called the fixed
GET https://api.easyslip.com/v2/info endpoint, but collapsed auth/network failures to NOT_VERIFIED.
The frontend had small generic feedback and a permanently NOT VERIFIED label. This change provides
an explicit per-account result panel and normalized provider error codes; it does not change slip
verification or credentials storage.

| Check | Result |
| --- | --- |
| Secret persistence / masking / blank preserve | PASS; existing security regression remains intact |
| /v2/info request | PASS via fake provider with URL, GET, Authorization, redirect and timeout assertions |
| Loading | PASS in real browser; visible loading label/panel, disabled button and duplicate guard |
| Success | PASS in real browser; clear Thai success panel, ACTIVE status, Real verification: VERIFIED |
| Invalid key / provider timeout | PASS in browser and API tests; safe distinct Thai messages |
| Missing key | PASS; visible setup hint, disabled action; backend 422 without network call |
| Verification persistence | NOT PERSISTED; result clears on reload/save and is bound to current config version |
| Secret exposure | NONE in rendered results/API/audit; no raw provider body or exception returned |
| Backend full regression | 211 PASS, 0 FAIL, 0 SKIP; local browsing/payment/promotion/Admin/Phase I smoke PASS |
| Final integration-settings suite | 16 PASS, including missing-key route response contract |
| Frontend / architecture / presentation | 158 PASS, 0 FAIL, 0 SKIP |
| Lint / production build | PASS; 44 generated pages |
| Secret scan / git diff --check | PASS |

Browser verification used compiled production frontend with an isolated local PostgreSQL schema
and a delayed injected fake provider (success, 401, TimeoutError). Console warnings/errors: none.
A second success followed by refresh returned to NOT VERIFIED while the key remained configured
and the password input stayed empty. Explicit synthetic-key clear exposed the missing-key hint.
No real EasySlip request, real credential or live payment was used. No quota/package fields were
invented; only the already validated active-account boolean is exposed as a safe enum.

Local processes became unavailable during cleanup. Restored PostgreSQL/backend/frontend using
existing scripts; checked fixture ciphertext/audit secrecy and dropped only this task's disposable
schema. Remaining test schemas: 0. Final isolated regression confirmed 39 public tables unchanged.
No reset/reseed of public data or environment edits were performed.

Commands: node scripts/isolated-local-verification.cjs; the same runner with --test
backend/test/integration-settings.integration.test.cjs; node --test scripts/*.test.cjs;
npm run lint; npm run build; npm run security:scan; git -c core.safecrlf=false diff --check.

Files changed: backend/src/integration-settings.cjs; backend/test/integration-settings.integration.test.cjs;
frontend/app/admin/settings/integrations/page.js; frontend/app/admin/settings/integrations/settings.module.css;
scripts/integration-presentation.test.cjs; docs/ADMIN_INTEGRATION_SETTINGS.md; VERIFICATION.md.

Business logic: UNCHANGED. Encryption/secret storage/masking, payment provider/state machine,
recipient mapping, Platform PromptPay, Finance, schema and RBAC: UNCHANGED.
Real provider verification: NOT RUN (fake provider only). Cloud: NOT DEPLOYED.
Git: NOT COMMITTED / NOT PUSHED.

## Admin Secret Reveal UX — 2026-10-09

ADMIN SECRET REVEAL STATUS: PASS

- Default mask/read-only current value and separate blank replacement input: PASS.
- Every reveal requires current Super Admin session, CSRF and bcrypt password re-auth: PASS.
- EasySlip, CheckSlip and three LINE integration secret keys: PASS with synthetic DB values.
- Bootstrap/ENV fallback/PromptPay exclusion; wrong role/password/expired or revoked session;
  five-attempt rate limit and safe Thai errors: PASS.
- Dedicated POST response no-store/no-cache; normal GET contains no plaintext: PASS.
- Audit SECRET_REVEALED records actor/setting/time without password or value: PASS.
- Temporary React state, hide/60-second timeout/tab hiding/pagehide/unmount/reload cleanup,
  late-response cancellation, double-submit guard and explicit-only copy: PASS.
- Backend: 212 tests PASS, no failures/skips, using isolated local PostgreSQL clone.
- Frontend/architecture/presentation: 162 tests PASS, no failures/skips.
- Existing browsing/payment/promotion/customer-to-rider completion/Admin smoke: PASS.
- Lint and production build: PASS.
- Browser QA against production frontend + isolated backend: masked/blank inputs, re-auth dialog,
  wrong-password feedback, successful reveal, copy, Hide and reload: PASS. Account test feedback
  remains VERIFIED on injected fake GET /v2/info success. No console warnings/errors captured.
- No actual EasySlip/LINE requests were made. Real-provider verification was NOT RUN.

Commands: npm run start-db; node scripts/isolated-local-verification.cjs;
node --test scripts/*.test.cjs; npm run lint; npm run build; npm run security:scan;
git -c core.safecrlf=false diff --check. Browser fixture also ran in the same isolated runner.
Existing demo tables were preserved; no migration, reset or seed was performed.

Files changed for this task: backend/src/admin-auth.cjs; backend/src/admin-router.cjs;
backend/src/integration-settings.cjs; backend/test/integration-settings.integration.test.cjs;
frontend/components/integration-secret-reveal.js; frontend/app/admin/settings/integrations/page.js;
frontend/app/admin/settings/integrations/settings.module.css; scripts/integration-presentation.test.cjs;
scripts/integration-secret-reveal.test.cjs; docs/ADMIN_INTEGRATION_SETTINGS.md; VERIFICATION.md.

Plaintext persisted: NO (manual Copy places the explicitly requested value on the clipboard).
Secret in logs: NO. AES-256-GCM encryption/payment logic/Finance: UNCHANGED.
Cloud: NOT DEPLOYED. Git: NOT COMMITTED / NOT PUSHED.

## Admin Merchant Payment Recipient Management — 2026-10-09

MERCHANT RECIPIENT ADMIN STATUS: PASS

- DB mapping: YES, encrypted reserved entries in existing integration_settings.secret_values.
- ENV fallback: YES, per merchant; explicit disable suppresses fallback, clear restores it.
- Schema/migrations: 0 changes; 37 application + 2 Knex tables retained.
- Admin UI: PASS at /admin/merchants/1 (Local Kitchen) → การรับชำระเงิน.
- Local Kitchen ready for Owner input: YES. No real account information entered for the owner.
- API: GET/PATCH /api/admin/merchants/:id/payment-recipient, Super Admin only, CSRF on writes.
- Server derives merchant/PromptPay identity; injected recipient fields rejected; cross-merchant
  slip receiver mismatch cannot mark PAID. No mapping stops before storage/provider calls.
- Full bank/PromptPay values excluded from public reads/audit. Stored mapping uses unchanged
  AES-256-GCM; blank account preserves, save/clear audited with version/row locks.
- Backend full tests: 218 PASS, 0 FAIL, 0 SKIP (includes RBAC/CSRF/IDOR/payment/mapping).
- Frontend/architecture/presentation: 165 PASS, 0 FAIL, 0 SKIP.
- Lint / production build / existing local browsing/payment/promotion/Admin/full completion smoke: PASS.
- Browser QA (production build + isolated DB): save, confirmation, reload persistence, masking,
  blank edit, disable, clear, Integration Settings readiness count: PASS. Console errors/warnings: 0.
- EasySlip real slip: NOT TESTED; fake HTTP provider only. Matching account pays; another enrolled
  merchant's account is rejected. Provider mode is never changed automatically by recipient saves.

The full isolated verification confirmed all 39 public tables unchanged. During subsequent browser
fixture cleanup, local processes became unavailable. Restored existing portable PostgreSQL and
backend/frontend scripts; checked the fixture's three save/disable/clear audit entries and absence
of raw bank identifier, then dropped only p0_test_9b4c568a5eca249b. No public reset/reseed or env edits.

Commands: node scripts/isolated-local-verification.cjs (full backend + smoke); same runner with
--test backend/test/merchant-recipient.integration.test.cjs; node --test scripts/*.test.cjs;
npm run lint; npm run build; npm run security:scan; git -c core.safecrlf=false diff --check.
Local services were restored with npm run start-db and npm run dev --workspace backend/frontend.

Files changed: backend/src/merchant-recipient-settings.cjs; backend/src/integration-settings.cjs;
backend/src/admin-router.cjs; backend/src/payment-service.cjs (safe message only);
backend/test/merchant-recipient.integration.test.cjs; backend/test/integration-key.test.cjs;
frontend/components/admin-merchant-recipient.js; frontend/components/admin-resource-page.js;
frontend/app/admin/merchants/[id]/page.js; frontend/app/admin/settings/integrations/page.js;
frontend/lib/payment-presentation.mjs (safe message only); scripts/merchant-recipient-presentation.test.cjs;
docs/ADMIN_MERCHANT_RECIPIENTS.md; docs/ADMIN_INTEGRATION_SETTINGS.md; README.md;
PROJECT_CONTEXT.md; DATABASE_SCHEMA.md; VERIFICATION.md.

Payment logic: UNCHANGED except config source and safe error presentation.
Centralized platform payment: NOT ENABLED. Finance: UNCHANGED.
Cloud: NOT DEPLOYED. Git: NOT COMMITTED / NOT PUSHED.
