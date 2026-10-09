# Admin Integration Settings — local implementation, 2026-10-09

## Audit and boundary

Existing `system_settings` is a non-secret allowlist and its reader returns entire records.
There was no reusable encryption helper. Reusing it for ciphertext would expose encrypted values
through the old settings API. Additive migration `202610090007_integration_settings.cjs` therefore
adds one private singleton table, separate from general settings. Migrations 001–006 are unchanged.
`SUPER_ADMIN` is the existing highest role; no OWNER role or new authentication system was added.
Existing Admin sessions, CSRF, audit service, shell and styles are reused.

Payment QR and verification remain **merchant-specific** (`merchants.promptpay_id` and type).
EasySlip recipient matching uses independently enrolled bank accounts configured in Admin Merchant
Detail, with `EASYSLIP_MERCHANT_ACCOUNTS` retained as the per-merchant ENV fallback. Global
Platform PromptPay can be stored encrypted but is **not wired to any order, QR or verification**.
Finance, settlement and centralized-payment cutover remain frozen.

## Owner setup

1. Apply migration 007 to the reviewed local DB. No seed is required.
2. Development/local needs no manual key setup: without an ENV key, the backend generates 32
   cryptographically random bytes once and persists base64 in `backend/.runtime/integration-settings.key`.
   Every restart reuses this file; the UI shows “การเข้ารหัส Secret พร้อมใช้งาน” and
   “Development key ถูกจัดการโดยระบบ”. This runtime directory is Git-ignored. Keep it across restarts
   and back it up privately with the DB; never delete it while encrypted settings depend on it.
   `INTEGRATION_SETTINGS_ENCRYPTION_KEY` always takes priority (existing keys are unchanged).
   `INTEGRATION_SETTINGS_KEY_FILE` may override the file location with an absolute path.
   Production **never creates a key**: supply the ENV key or provision an existing persistent key file
   outside the checkout, e.g. `/etc/select-topic-2/integration-settings.key`, containing standard base64
   for 32 random bytes. Set POSIX permissions 600 and service-user ownership (directory 700).
   Development creation uses 600/700; on Windows the file ACL grants only the current user and SYSTEM.
   Test/staging without explicit keys remain unavailable, with no automatic generation.
   Missing production key configuration keeps secret writes disabled; an explicit missing/corrupt key
   file fails startup. A corrupt existing development file is never overwritten. Restart after changing
   bootstrap key configuration. Keys, key file paths and file contents never appear in Admin responses.
3. Open Admin → **การเชื่อมต่อระบบ**, `/admin/settings/integrations`, as Super Admin.
4. Set EasySlip API key. The base URL is fixed to the adapter's allowlisted v2 origin. Configure
   merchant account mappings in Admin Merchant Detail (or existing ENV) before selecting EasySlip in Payment.
   Keep local payment in mock until intentionally switching providers; production rejects mock.
5. Optional Platform PromptPay: choose an actually supported identifier type, enter identifier and
   display name, then confirm. This stores future configuration only; the page explicitly says
   it does not change the existing payment recipient.
6. Set LINE Login Channel ID / LIFF ID; set the Messaging channel token and **Messaging channel
   signing secret** in the Messaging/Webhook section. `LINE_CHANNEL_SECRET` retains the old
   webhook fallback; it is not used for ID-token verification. Auth mode and dev-login switches
   remain bootstrap controls: production requires `CUSTOMER_AUTH_MODE=line`, `ENABLE_DEV_LOGIN=false`.
7. Use configuration testing first. READY means structurally configured, **not connected**.
   Missing public HTTPS URL is shown explicitly. Copy derived Webhook and LIFF endpoints to LINE
   Developers yourself; the application never changes that console.
8. Only after production HTTPS and account enrollment are ready, intentionally test providers.
   No live key, slip, LINE call or provider verification was performed during implementation.

## Secret handling and precedence

DB override → ENV fallback → explicit default. No permanent config cache: the backend reads a
consistent snapshot per operation. An in-flight verification finishes with the snapshot it started
with; subsequent requests use the new settings. Existing authenticated sessions are preserved.
Disabling LINE Login prevents new logins; it does not revoke existing sessions.

Secrets use Node crypto AES-256-GCM, random 12-byte nonce, 16-byte tag, versioned envelope and
field-bound authenticated data. Normal settings are separate JSONB; secret values contain only
ciphertext envelopes. GET never returns plaintext, ciphertext, nonce or tag. It returns configured
state/source, and only masked last digits for PromptPay. No provider responses are returned by tests.
The frontend clears secret inputs immediately on submit, including failed saves, and never stores
them in browser storage. Blank or omitted secrets keep their value. Mask placeholders are rejected.

Clear explicitly removes the DB override and restores ENV/default, rather than deleting server
environment variables. To remove the effective secret entirely, also remove the server fallback
through the operator's secure environment workflow. Disable the relevant service before removing
its required credentials. Changes/clears require confirmation in the UI; dangerous writes also
require `confirm: true` in the API. All writes and test actions are Super Admin + CSRF protected.

The singleton row is locked, version checked, updated and audited in one transaction. A stale tab
gets 409 and must reload. Audit records contain actor, action, field names and before/after configured
booleans only. Wrong/missing master keys fail closed. Back up the bootstrap key separately: replacing
it without re-encrypting overrides makes them unreadable. Automatic master-key rotation is not built.
Existing ENV-encrypted settings need that same ENV key; removing it does not migrate old ciphertext
to a generated key. A lost key cannot be recovered from ciphertext, and decryption failures never
fall back to plaintext. Concurrent development starts publish a complete file without overwriting
an existing key. No encryption envelope, RBAC, schema or provider behavior changed for this feature.

## API

- `GET /api/admin/settings/integrations`: safe fields, sources, readiness, endpoint helpers.
- `PATCH /api/admin/settings/integrations`: `{ version, values, clear?, confirm? }`; values use the
  allowlisted setting names and string representations, including `"true"`/`"false"`.
- `POST /api/admin/settings/integrations/test`: configuration only, no network.
- `POST /api/admin/settings/integrations/test-easyslip`: explicit `{ version, confirmRealRequest: true }`.
  This calls the official [GET /v2/info](https://document.easyslip.com/en/v2/info) with a saved key.
  A successful response means **ACCOUNT_AUTH_VERIFIED**, not slip/recipient verification. The result
  is transient and applies only to that version; refreshing never labels an untested config connected.
  Account checks show a dedicated loading/success/error panel under the EasySlip button. The UI
  displays `Real verification: VERIFIED` only after this account request succeeds, and clears it
  on reload/save or when an unsaved API key differs. No verification status column was added.
  The response allowlists result/version, normalized failure code, ACTIVE/INACTIVE account status,
  and `slip_verification: NOT_VERIFIED`; no provider body, account identity, token or headers escape.
  HTTP 401/403 maps to INVALID_API_KEY; timeout/network/5xx/rate limits map to PROVIDER_UNAVAILABLE.
  Missing saved key returns `easyslip_api_key_missing` without a provider request. Inactive/malformed
  account responses never label the account verified. Backend timeout remains 5 seconds; the UI
  also bounds its request at 10 seconds, disables repeated submission and renders safe Thai errors.
  Normal audit entries retain only the request version and normalized result/failure code; these
  audit records are separate from the non-persistent presentation status.

Global payment enable/disable is enforced at the runtime boundary. Disabling blocks new attempt,
QR and upload operations but preserves payment history reads. It does not modify order/payment
records or roll back an in-flight operation. LINE messaging and webhook resolve secrets server-side
on each push/handle; signature verification still operates on raw request bytes. Provider test URLs
cannot be overridden per request. EasySlip uses its fixed official origin; CheckSlip URLs require HTTPS.

## Deployment and verification

Integration values remain optional ENV fallbacks, not public frontend variables. Storage, database,
public URL, proxy policy and authentication modes remain server bootstrap environment. The deploy
preflight now resolves DB overrides before validating provider/LINE configuration; it does not print
values. Migration 007 must be applied first. Do not deploy with a missing encryption key when any
encrypted override exists. A failed DB read/decryption never silently falls back to stale credentials.

Run `node scripts/isolated-local-verification.cjs` for backend tests and the existing full local E2E.
The disposable clone clears **only its copied integration overrides** to guarantee mock payment and
disabled LINE even if the original DB later has real settings. Public demo data is fingerprinted before
and after. Automated tests inject fake providers; do not run manual provider tests automatically.

Browser QA was completed on 2026-10-09 against the real production frontend build and an isolated
local PostgreSQL clone: all six sections save through PATCH and survive page refresh. Only synthetic
values were entered. The optional account test used an injected fake `/v2/info` provider, never real
EasySlip. Native `window.confirm` stalled in the in-app browser; this page now uses a labelled HTML
dialog with Cancel/Confirm and Escape behavior. Confirmation remains required before saving/clearing
or sending an account-test request. The save controls have explicit scoped primary/secondary styles,
loading/disabled state and immediate duplicate-submission protection. Feedback appears by the
section being saved. Saving one section preserves other section drafts; submitted secret inputs
are cleared immediately, including on failure. EasySlip Base URL remains a fixed, read-only adapter
value. No provider, payment-recipient, schema or RBAC logic changed.

Desktop 1280×900 and mobile 430×932 had no page-level horizontal overflow. Save/refresh, configured
masking, blank preservation, clear override, cancellation and friendly validation errors passed in
the browser. Test secrets and sessions were removed with the disposable schema. See VERIFICATION.md
for exact results and the concurrent local-session metadata preservation warning.

## Secret reveal (2026-10-09)

`POST /api/admin/settings/integrations/secrets/:key/reveal` accepts `{ password }`.
A current, active Super Admin session, CSRF token and the current admin password are required
on **every request**, including local/demo. Re-auth uses the existing bcrypt verifier, not a
new password or development bypass. Responses (including rejected requests) have
`Cache-Control: no-store` and `Pragma: no-cache`. Successful responses contain only `{ value }`.

The explicit allowlist is EASYSLIP_API_KEY, CHECKSLIP_API_KEY,
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET and LINE_WEBHOOK_SECRET.
Only encrypted DB overrides are revealable; ENV fallbacks and PromptPay identifiers are not.
Session/bootstrap/master encryption/DB secrets cannot be selected through this route.
Normal settings GET still returns no plaintext/ciphertext, only a `revealable` boolean in addition
to its previous safe metadata. Masks use fixed bullets (no suffix disclosure).

Re-auth has a separate 5-attempt/15-minute limit per admin, counting successes and failures before
bcrypt awaits. Logging in again does not reset it. Like the existing login limiter, this is an
in-process limit intended for the current single backend instance; it resets at process restart.
Every successful reveal must write SECRET_REVEALED to the existing audit log before returning.
The log contains actor, timestamp, setting name and config version, never value/password.

The UI separates a read-only current masked value from an empty replacement input. Passwords
clear immediately on submission/cancel. Revealed values live only in component memory and clear
on Hide, 60-second expiry, hidden tab, pagehide, route unmount, reload, or a settings operation.
Cancellation/unmount invalidates in-flight requests so late responses cannot redisplay a value.
Copy requires an explicit click while revealed. Hiding does not erase the user's clipboard;
the UI states this. No secrets are saved to browser storage, URLs or cookies.

Encryption format, master-key handling, blank-secret preservation, provider/account checks,
PromptPay recipients, LINE/payment business logic, schema and Admin roles are unchanged.
Automated/browser QA uses synthetic values and fake providers, never live credentials.

## Merchant recipient overrides — 2026-10-09

Merchant recipient enrollment metadata is now managed at Admin → ร้านค้า → รายละเอียด → การรับชำระเงิน
by Super Admin. Reserved encrypted `MERCHANT_RECIPIENT_<id>` entries reuse the existing private
settings singleton; no migration is added. The server pins each override to that merchant's current
PromptPay identity and merges it over ENV per merchant. Disabled overrides fail closed; explicit
clear restores ENV fallback. Integration Settings shows per-merchant readiness counts separately
from the transient API account-test result. See `docs/ADMIN_MERCHANT_RECIPIENTS.md` for API,
validation, audit and owner setup. Centralized payment/Finance remain frozen.
