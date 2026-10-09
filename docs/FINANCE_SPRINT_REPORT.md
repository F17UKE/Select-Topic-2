# Final Finance Implementation — Local Report

Owner Confirm Paid decision is resolved: transfer reference is mandatory; private proof is optional. This continues FINANCE_SPRINT_PREFLIGHT.md, without repeating the original audit or discarding the working tree.

## Implemented scope

- Centralized collection is opt-in through Super Admin Finance, with password reauthentication and audit. Public local mode remains LEGACY_MERCHANT_DIRECT. A new immutable recipient version pins the PromptPay ID and verified bank mapping on new orders/payments. Editing Integration Settings alone does not retarget historical orders.
- Commission is 500 bps on food less merchant-funded food discount; no commission on delivery. Platform-funded subsidy does not reduce the base. BigInt/integer satang, deterministic half-up; existing decimal payment boundary accepts exact satang only.
- Double-entry posted journals are immutable. Deferred PostgreSQL constraint triggers validate aggregate debit=credit; postings cannot move or be appended after their creating transaction. Permanent event keys, same-merchant source checks, foreign keys and merchant serialization protect concurrent work. Balances are derived from postings, never cached as authority.
- PAID credits PENDING; COMPLETED releases once, offsets DEBT first and credits AVAILABLE. Paid rejection moves the remaining entitlement to HELD. Legacy orders never receive invented journals.
- MANAGER Finance at /merchant/finance: balances, paid-out total, sales/discount/GP summary, net advertising expense, ledger lines, withdrawal and payout-account management. Latest 100 transaction/detail rows are shown; summaries cover all financial rows.
- Payout accounts use existing AES-256-GCM, masked lists and immutable versions. Verification/change starts a 24-hour hold and flags open withdrawals for review. Existing PROCESSING transfers keep their original destination snapshot. Cancel/reject a pre-transfer flagged request and submit again after verification/hold.
- Withdrawal: minimum 30000 satang, unlimited maximum, fee zero. One in-flight request per merchant; reserve/release/finalize exactly once. REQUESTED -> APPROVED -> PROCESSING -> PAID. REQUESTED/APPROVED may cancel/reject; PROCESSING may fail only after explicit confirmation that no money left the bank. PAID starts 72-hour cooldown; failure/rejection/cancellation do not.
- Admin /admin/finance: financial metrics, masked account review, payout queue, advertising review, component refunds and reconciliation. FINANCE can review/approve/process; only SUPER_ADMIN can configure recipient/mode, verify/reveal bank details, recognize/refund cash or Confirm Paid/Failed. Sensitive actions reauthenticate. Reveal is audited, no-store, hidden on blur or after 60 seconds, never persisted in browser storage.
- Confirm Paid stores actor/time and normalized reference. Normalization: NFKC, remove whitespace, uppercase; 3–160 ASCII characters from the documented reference alphabet. UNIQUE(provider, source_account_key, external_reference) spans withdrawal and refund. The source key hashes bank code + account number and survives recipient-version rotation. Browser cannot choose this namespace. Duplicate reference rejects atomically without PAID. Any future transfer provider must pin its authoritative transaction ID here; no automated bank provider is implemented.
- Optional proof uses validated JPG/PNG/WebP (4 MiB) and finance-proofs/YYYY/MM/UUID.ext through existing local/S3 storage; no public URL or public ACL. Only Super Admin can upload. Slip purge_after cleanup never selects financial proof objects. No automatic financial-history/proof retention deletion is introduced.
- Multiple partial refunds allocate food, explicit delivery, merchant discount, platform subsidy, GP and merchant recovery cumulatively against the immutable snapshot. Concurrent over-refunds reject. No delivery refund unless requested. Before completion debit PENDING/HELD; after completion debit AVAILABLE, with any shortfall recorded as DEBT. Previously paid journals stay unchanged. A zero-economic-value component refund needs no zero-value journal or bank movement.
- Ads: explicit 30000-satang AVAILABLE charge / 30 days, PAID_PENDING_REVIEW until Admin activates the existing banner. Pre-active cancellation/rejection returns full value; after ACTIVE merchant cancellation forfeits the unserved portion. Platform termination refunds unserved time. Served recognition is floor(fee * elapsed milliseconds / total milliseconds); the residual is unserved. Physical service, forfeiture and refund remain separate exact snapshots. Deferred revenue is recognized on expiry/termination/cancellation, not by a daily recognition worker.
- AUTO_3_DAYS is opt-in and uses fixed UTC 72-hour windows. The CLI creates a normal request, never sends money, respects verified account/minimum/hold/cooldown/debt/HELD and uses a permanent merchant/window key. Repeated/concurrent runs do not reserve twice. The same CLI finalizes expired ads.
- Reconciliation detects missing capture/release, withdrawal/refund/transfer mismatch, cumulative over-refund and advertising journal gaps. Cases dedupe permanently; no automatic adjustment, bank-statement import or silent historical repair.

## Migration and preservation

Migration: backend/migrations/202610090008_marketplace_finance.cjs. Migrations 001–007 unchanged. Local up PASS; 001–008 complete, pending 0. 12 new tables; 49 application / 51 public tables including Knex.

Existing altered tables: merchants (account hold timestamp, settlement mode), orders (collection mode, recipient FK), payments (recipient FK), promotions/coupons (funding source). system_settings gains a private finance.runtime row, without table DDL. Existing banners, sessions and audit infrastructure reused.

Before up: full local custom-format pg_dump at ignored backend/.runtime/pre-finance-008.dump, ACL restricted to the current Windows user. Original-column fingerprints for all 37 existing application tables match after up. Backfill: 16 orders LEGACY_DIRECT, 2 promotions + 1 coupon LEGACY_UNKNOWN. No historical commission, balance, journal or guessed funding. No seed ran on public.

New campaigns require MERCHANT or PLATFORM. LEGACY_UNKNOWN may survive only on existing rows; normal inserts or conversion back to unknown reject. A centralized order using unresolved legacy funding rejects until the campaign is reviewed, never guesses.

## Verification evidence

See VERIFICATION.md for final command results. Finance integration tests run only in disposable schemas. Existing regressions and each smoke suite run in fresh clones so immutable financial fixtures do not contaminate later counts. Every clone is dropped and all 51 public table fingerprints are checked unchanged.

Browser QA used a disposable clone and production frontend build: an order was created/paid/completed through actual application services, then browser Manager login -> withdrawal 300 -> Admin approve -> processing -> Confirm Paid with required reference and no proof -> PAID. Manager shows paid-out amount, reserved zero and friendly 72-hour cooldown rejection. Banner purchase debited 300 from AVAILABLE. Admin and Merchant Finance have no horizontal overflow at tested 390/768/1280 widths. Console error/warning capture empty. No real bank/provider request was made. Synthetic bank identifiers and QA users lived only in the removed clone.

## Local operator workflow

1. Keep the persistent integration encryption key backed up securely; losing it loses access to encrypted recipient/account versions. Never commit runtime files, keys, dumps or private proofs.
2. Start the existing local DB/backend/frontend. Apply pending migrations using the project's standard db:migrate command only after checking the intended target and backup.
3. Sign in as Super Admin, open /admin/finance, review Platform PromptPay/bank mapping and explicitly create a recipient version to enable centralized collection for NEW orders. Default has not been changed in public.
4. Review funding for active campaigns before cutover. Saving/clearing an Integration Settings value cannot rewrite a pinned recipient.
5. Merchant Manager adds payout account; Super Admin verifies after inspecting details. Initial/change hold is 24 hours. Request withdrawal only from earned AVAILABLE; do not bypass a hold by editing production timestamps.
6. Admin approves and marks processing. Perform the actual external bank transfer separately; then only Super Admin confirms with its authoritative bank reference. A timeout is not evidence of failed transfer. Never confirm a second business record using the same reference.
7. Run npm run finance:scheduled --workspace backend from an external scheduler (for example hourly) after configuring the proper environment. No scheduler was installed or enabled by this task. It creates requests in three-day windows and expires ads; it does not move bank funds.
8. Run reconciliation and investigate every case with ledger + bank evidence. No auto repair.

## Outside this local verification

Real Platform QR/recipient/bank reconciliation and a real EasySlip slip verification need a separately authorized bounded manual run. Real S3 upload/head/delete and production encryption-key recovery are also NOT RUN here. Existing real /v2/info verification is historical evidence, not a new provider test.

Cloud NOT DEPLOYED. Git NOT COMMITTED / NOT PUSHED. No synthetic financial balances seeded. Admin redesign preserved; only finance navigation/content and campaign funding controls were added.

## Files added/changed in this continuation

Compared with the saved preflight fingerprints (not HEAD, which includes earlier unfinished work):

- `backend/migrations/202610090008_marketplace_finance.cjs`
- `backend/scripts/finance-scheduled.cjs`
- `backend/src/admin-auth.cjs`
- `backend/src/admin-router.cjs`
- `backend/src/admin-service.cjs`
- `backend/src/coupon-service.cjs`
- `backend/src/finance-money.cjs`
- `backend/src/finance-router.cjs`
- `backend/src/finance-service.cjs`
- `backend/src/payment-verifiers/easyslip-provider.cjs`
- `backend/src/promotion-service.cjs`
- `backend/test/admin-backoffice.integration.test.cjs`
- `backend/test/finance.integration.test.cjs`
- `backend/test/phase-f.integration.test.cjs`
- `backend/test/phase-h.integration.test.cjs`
- `docs/FINANCE_IMPLEMENTATION_PLAN.md`
- `docs/FINANCE_SCHEMA_IMPLEMENTED.md`
- `docs/FINANCE_SCHEMA_PROPOSAL.md`
- `docs/FINANCE_SETTLEMENT_DESIGN.md`
- `docs/FINANCE_SPRINT_PREFLIGHT.md`
- `frontend/app/admin/coupons/page.js`
- `frontend/app/admin/finance/page.js`
- `frontend/app/admin/promotions/page.js`
- `frontend/app/merchant/finance/page.js`
- `frontend/components/admin-shell.js`
- `frontend/components/finance-panel.js`
- `frontend/components/finance-panel.module.css`
- `frontend/lib/finance-presentation.mjs`
- `frontend/lib/staff-portal.mjs`
- `scripts/finance-presentation.test.cjs`
- `scripts/isolated-local-verification.cjs`
- `VERIFICATION.md`
- `DATABASE_SCHEMA.md`
- `PROJECT_CONTEXT.md`
- `README.md`
- `backend/package.json`
- `backend/scripts/verify-local-db.cjs`
- `backend/seeds/001_local_development.cjs`
- `backend/src/app.cjs`
- `backend/src/merchant-order-service.cjs`
- `backend/src/order-service.cjs`
- `backend/src/payment-service.cjs`
- `backend/src/rider-order-service.cjs`
- `backend/src/server.cjs`
- `backend/src/slip-storage.cjs`
- `backend/test/slip-object-storage.test.cjs`
- `scripts/payment-smoke.cjs`
- `docs/FINANCE_SPRINT_REPORT.md`

No baseline file is missing. The saved hashes of migrations 001–007 and existing admin-ui.js/admin-ui.css/admin-presentation.mjs still match. Runtime QA scripts, logs, screenshots and backup are ignored and excluded from this list.

## Final local result

**FINAL FINANCE IMPLEMENTATION STATUS: PASS (local mocked-provider scope)**

Backend 243 PASS; frontend/architecture/presentation 179 PASS; lint/build, Finance integration, all isolated legacy smokes, secret scan and diff check PASS. Production dependency audit: zero vulnerabilities. Real S3/LINE/EasySlip/bank transactions NOT RUN.

Local health after verification: 3001/api/health API+database ok; 3000/health frontend ok; 3000/api/health proxy API+database ok. Existing local processes reused.
