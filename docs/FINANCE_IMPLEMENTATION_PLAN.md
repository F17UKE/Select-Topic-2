# Finance — current implemented baseline (2026-10-09)

Owner authorized the final sprint and resolved the Confirm Paid gate: mandatory normalized unique transfer reference; optional private proof; actor/time/audit required. Migration 008 and the local Finance implementation now exist.

The current implementation and operator policies are documented in [FINANCE_SPRINT_REPORT.md](FINANCE_SPRINT_REPORT.md). It supersedes older review-only status, migration 007 numbering, full-refund-only restriction, mandatory-proof condition and manual-only settlement described in the archive below.

Current database: migrations 001–008 complete, pending 0, 49 application / 51 public tables. Default remains LEGACY_MERCHANT_DIRECT. No historical financial balances were fabricated. Confirm Paid is SUPER_ADMIN-only after reauthentication. Shared bank-reference uniqueness applies to withdrawal and refund across recipient-version rotation.

## Archived exact review (historical record, not current implementation status)

# Finance / Merchant Settlement — Review and Implementation Plan

**PLAN ONLY · No migration/application implementation authorized**  
Updated 2026-10-09. [Design](FINANCE_SETTLEMENT_DESIGN.md) locks all25 Owner policies.
[Exact schema](FINANCE_SCHEMA_PROPOSAL.md) specifies12 proposed tables/176 columns and7 existing-table additions/7 columns.
[Original audit](FINANCE_SETTLEMENT_AUDIT.md) is preserved unchanged.

## 1. Current review gate and evidence

- Local baseline inspected read-only: select_topic_2_local at loopback; migrations001–006 complete, pending0; DB verification PASS,36 application tables.
- Existing dirty working tree preserved; session recorded Git status and hashes for282 tracked/unignored files (176 status paths at start).
- Scope is exactly these3 Markdown documents; no application/source/env/seed/schema edits.
- No full application regression rerun claimed: docs-only checks do not test a future finance implementation.
- End-of-review checks: new-column counts/constraint references, accounting example arithmetic, Markdown references, secret scan, whitespace, file-hash boundary and unchanged DB catalog/migration history.
- Review READY means exact proposal ready for Owner schema approval; it is not production readiness or permission to implement.

## 2. Approval gates

**Already final, do not ask again:** the25 Owner policies including500bps, minimum30000, unlimited maximum, zero fee,72h cooldown,24h account hold, MERCHANT/PLATFORM funding, merchant delivery, debt recovery, banner30000/30days, MANAGER-only requests, SUPER_ADMIN payout confirmation, new-order-only cutover.

**Still required before implementation:** approve this exact additive schema and technical controls (single in-flight withdrawal, shared transfer reference namespace, restricted posting API, recipient secret versioning).
Only2 unchosen business extensions remain:
1. Full-refund examples reverse original GP/delivery/subsidy completely; confirm that allocation before refund execution is enabled. Partial refunds remain out of initial scope.
2. Proposed ad revenue recognition1000/day for30 elapsed24h periods; approve this and mid-service cancellation/proration before those actions enable.

Operational readiness: select managed versioned encrypted secret storage/private evidence, verify account ownership, permissions/re-auth, and real provider/bank reconciliation.
These are not unresolved values for the locked25 policies.
No finance cutover until safe manual refund/hold/reconciliation procedures are ready, even if feature development is staged.

## 3. Next migration proposal — DO NOT CREATE OR RUN

Actual files checked:

1. 202610020001_initial_schema.cjs
2. 202610020002_production_hardening.cjs
3. 202610050003_admin_backoffice.cjs
4. 202610060004_promotion_checkout.cjs
5. 202610060005_merchant_opening_hours.cjs
6. 202610070006_customer_engagement.cjs

Proposed next file: **202610090007_platform_finance.cjs**.
No such file is created by this review. Re-list repository/history immediately before an explicitly authorized implementation to avoid sequence collision.
Never modify001–006.

### Dependency-ordered operations inside proposed migration

| Step | Operation | Safety / dependency |
|---|---|---|
| 1 | Assert parent column types/PK/UQ expectations and six completed migrations; take verified backup before applying on any nonempty target | Abort on schema drift; never reset/delete current local DB |
| 2 | Create finance_policy_versions, platform_payment_recipients, financial_accounts with columns/PK/UQ/CHECK/indexes | Parent existing merchants/admins; no active policy/recipient automatically seeded |
| 3 | Add seven existing columns with exact defaults; add orders/payment/banner composite UQs; route/funding checks and indexes | Existing orders LEGACY_DIRECT+NULL; existing payments NULL; no monetary rewrite |
| 4 | Create order_financial_snapshots, merchant_payout_accounts, merchant_withdrawals, finance_refunds, finance_transfers, advertising_orders, finance_reconciliation_cases, financial_transactions, financial_postings | First declare columns/PK/UQ/checks; defer attaching cyclic FKs until all referenced tables exist |
| 5 | Attach all remaining exact RESTRICT FKs and indexes from schema catalog | Transfer↔case↔journal relationships supported; no manual ID guessing |
| 6 | Make outbox.order_id nullable; attach financial_transaction_id FK and XOR CHECK | Old nonnull order rows pass; finance producer not yet active |
| 7 | Install guarded posting/state API, immutable/deferred balancing/source/tenant/balance triggers, least-privileged grants | Mandatory integrity, not an optional later optimization; trusted bootstrap path separate from application |
| 8 | Add private disabled finance.runtime setting through existing validated settings workflow, audited | No credentials; enabled=false, MANUAL_WITHDRAWAL; no automatic payouts |
| 9 | Validate all constraints and row-classification counts; verify old routes/tests still pass | PostgreSQL DDL transactional where supported; explicit lock_timeout/statement_timeout; no production seed |
| 10 | Grant operational read/execute permissions only after guard coverage verified | Application cannot write raw journal or bypass mutation guards |

Avoid redundant FK indexes covered by leading PK/UQ/B-tree keys; exact index catalog already specifies these.
For large cloud tables, assess lock duration and NOT VALID→VALIDATE options in an approved rollout; do not hide unsupported “zero downtime” assumptions.
No CREATE INDEX CONCURRENTLY inside the same migration transaction; use a separately reviewed online step if dataset size requires it.

### Rollback implications

- Before finance data/route usage: rollback only if preflight proves no PLATFORM orders/payments, no finance business/journal rows or linked outbox rows, no schema-dependent deployment active. Back up even then.
- Drop dependency FKs/guards/grants before dependent tables/columns; restore outbox.order_id NOT NULL only after confirming no finance-only rows.
- Removing policy/recipient/account references loses review evidence; export/retain it first. Never discard a finance journal to make down() succeed.
- Once first platform order/payment/journal exists: destructive down must explicitly refuse. Pause new intake, retain recipient resolution/worker/reconciliation, apply a forward fix. Old application binary must not be rolled back against platform orders without route-aware compatibility.
- PostgreSQL transaction rollback of a failed migration is distinct from erasing committed financial history.
- No automatic historical cash/commission “reverse backfill” on rollback.

## 4. Backfill plan (explicit legacy / unknown)

| Field / entity | Existing-data treatment | Forbidden inference |
|---|---|---|
| orders.collection_mode | All pre-migration orders LEGACY_DIRECT | Do not classify as PLATFORM based on current config |
| orders.payment_recipient_version_id | NULL | Do not copy today's merchant PromptPay into historical records |
| payments.payment_recipient_version_id | NULL for legacy attempts/payments | Do not attach current platform recipient to old payment |
| promotions/coupons.funding_source | NULL initially = unknown; explicitly classify CURRENT eligible offers with audit before cutover | Do not rewrite existing order promo/coupon snapshots |
| merchants.payout_account_changed_at | NULL until first verified workflow change/request; initial setup starts24h hold | Do not invent account-change time from merchant.updated_at |
| notification_outbox.financial_transaction_id | NULL for existing order events | Do not relabel already sent order events as ledger notifications |
| order_financial_snapshots / journal | No rows for historical legacy orders; all opening finance balances0 | Do not estimate historical commission, custody, subsidy or earnings |
| merchant_payout_accounts | Explicit secure onboarding/verification | Merchant QR recipient is not automatically a verified payout destination |
| reconciliation cases | Only real observed unresolved cases, including LEGACY_UNKNOWN if needed | No fictitious proof or automatic platform liability from legacy sums |

Existing numeric fields and order/payment statuses remain as-is. Metadata defaults classify old records without rewriting original amounts/recipient facts.
Preserve known historical external evidence privately if supplied; do not manufacture a historical snapshot where none existed.
If a real opening balance is ever needed, require independently verified opening statement, approval and a separate reviewed balanced journal; not part of this migration.

## 5. Implementation phases after explicit approval

| Phase | Work | Required acceptance |
|---|---|---|
| F1 Recipient/cutover | Versioned encrypted recipient resolver, mode+version on new order/payment, existing QR/verification adapter uses pinned identity | Exact account+amount checks; legacy unchanged; all writers route-aware; feature disabled |
| F2 Finance core | Approved additive migration, BigInt math, snapshot, constrained append-only journal, atomic PAID/outbox | Balanced/source-safe journals, permanent uniqueness, no history backfill |
| F3 Completion/holds | Existing COMPLETED observer, paid cancellation hold, debt-first release | No duplicated release, no premature AVAILABLE, no changed fulfillment transitions |
| F4 Withdrawal/account | Verified versioned payout accounts,24h hold,72h paid cooldown, MANAGER request, reserve/release, re-auth/CSRF | Concurrency/IDOR/idempotency pass; one in-flight, no overspend |
| F5 Admin transfer | Review permissions, manual attempt STARTED/UNKNOWN, shared bank ref, SUPER_ADMIN confirmation, proof privacy | No double payout; uncertain outcome cannot release; changed account review enforced |
| F6 Merchant finance views | Derived balances/debt/ledger, account/withdrawal status, explicit ad consent | Read-only server amounts; no client eligibility authority; existing pages untouched |
| F7 Admin finance views | Liabilities, earned commission, subsidy, cash/clearing, transfer queue, cases | Current sales report not relabeled profit; least-privilege fields and audit |
| F8 Advertising | Atomic30000 AVAILABLE debit, existing banner moderation/schedule,30-day service | No unfunded active banner; pending-revenue separate; gated cancellation policy |
| F9 Refund/reconciliation | Approved full-refund allocation, debt offsets, private evidence, daily checks/cases | No mutation of payout history, no negative availability; bank/ledger mismatch visible |
| F10 End-to-end rehearsal | Isolated fake providers and explicit manual real-provider/bank checks after authorization | All finance tests; backup/forward-fix procedure; bounded supervised real money only |

F9 safety essentials must exist before F1/F2 centralized custody is enabled; table order is not permission to launch incomplete custody.
Do not alter merchant/kitchen/rider business transitions or customer totals beyond specifically approved funding/recipient/finance consumers.
Tax invoices, automatic bank transfer, auto-settlement, split funding, partial refunds and unrelated features are outside first implementation.

## 6. Cutover runbook (future, not executed)

1. Verify target DB, backup/restore rehearsal, migration history and code compatibility.
2. Apply only approved additive007; validate existing service behavior with enabled=false.
3. Onboard immutable platform recipient/policy and verified private account/evidence config. No keys in Git/settings logs.
4. Resolve current campaign funding; prohibit unknown-funded new centralized offers.
5. Pause new checkouts for controlled boundary; drain/reconcile pre-cutover unpaid legacy orders. Unknown payee requires manual resolution; never issue platform QR for it.
6. Prove all app/worker instances route-aware. Configure DB route guard to reject legacy creation once enabled.
7. New-order creation obtains finance.runtime FOR SHARE before source locks. Activation obtains same row FOR UPDATE, waits prior creators, records DB-clock cutover_at and enabled=true with immutable version pointers.
8. Resume creation; all new orders explicitly PLATFORM; copies same version to payment attempts. Original orders keep legacy mode and original observations forever.
9. Observe captures/releases/balances/outbox/bank matches and supervised manual withdrawal; eligibility remains server-controlled.
10. Receiver rotation creates new version + audited pointer; old pending platform orders still verify old pinned account.
11. Pause new intake on incident; do not reinterpret existing platform or historical merchant payments. Resolve obligations with existing version/config and forward fix.

## 7. Implementation test matrix — not tests executed in this docs-only task

All automated provider/bank calls use fakes, disposable test DB and synthetic accounts. No real credentials/slips.
Tests use actual PostgreSQL locking/constraints, not only mocked repositories.

| Group | Cases and assertions |
|---|---|
| Commission | Case1 F10000/D1500→C500,N11000; exactly500bps; no GP on delivery |
| Funding | Merchant food discount2000 onF20000→B18000,C900; platform discount2000→B20000,C1000,S2000; no SPLIT; unresolved funding rejected only for new centralized use |
| Free delivery | Merchant-funded→N9500,C500; platform-funded→N11000,C500,S1500; not counted twice |
| Rounding | Base9→0,10→1,11→1,30→2 at500bps; no float; strict satang parser rejects excess fractions; large supported values and overflow rejected |
| Snapshot | Source order/payment/recipient/merchant consistent; cannot use frontend funding/commission; later campaign/policy edits leave prior snapshot unchanged |
| Balanced journal | Header-only rejected; unequal Dr/Cr rejected; zero/negative line rejected; wrong tenant/account/currency rejected even if sums match; raw SQL writes denied; no append of balanced extra lines to a previously committed header |
| Exactly once | Same capture key+fingerprint returns original after restart; mismatch conflicts; same paid payment never captured twice; HTTP cache expiry does not erase economic uniqueness |
| Concurrent completion | Two DB connections release once; crash before commit produces neither partial order status nor journal; crash after commit reuses original |
| Merchant buckets | No negative pending/available/reserved/held; debt not negative bucket; no new spendable AVAILABLE before debt offset; cross-order fungible availability reconciles |
| Concurrent withdrawal | AVAILABLE50000, two requests40000→only one; withdrawal vs banner/refund/account-change serialized; sum of liabilities remains correct |
| Bounds | 29999 rejected,30000 allowed, max NULL truly uncapped, fee0; balance still caps amount |
| Cooldown | paid_at+259199.999s blocked; +259200s allowed; UTC/daylight date edge independent; FAILED/REJECTED/CANCELLED never set/reset paid_at |
| Payout hold | Change+86399.999s blocked,+86400 allowed; initial setup hold; repeated changes extend; change-back cannot bypass |
| Account review | Pending request retains old account FK, flags latest change; stale review cannot clear; new execution blocked before hold/review; already executed payment reconciled honestly |
| Payout double confirm | Two SUPER_ADMIN confirmations produce one transfer disposition and one journal; shared bank ref conflicts across withdrawal and refund, including credential rotation |
| Failed payout release | Proven non-transfer releases once (debt/hold-aware); UNKNOWN/timeout neither releases nor retries bank action; terminal requests immutable |
| Full refund before payout | Case6 journal totals11500 balanced; original snapshot unchanged; release availability0; double approval/payment blocked |
| Refund after payout | Case7 debt11000; original paid withdrawal retained; future8000+5000 produces debt0/available2000; insufficient platform cash never claims paid refund |
| Reserved refund race | Refund during UNKNOWN transfer does not release reserved claim; later failed transfer routes recovered funds into debt/held first; later confirmed transfer cannot be paid twice |
| Banner debit | Case8 available50000→20000; fee30000/duration30; explicit consent and version; duplicate submission one charge |
| Banner insufficient | AVAILABLE29999→no journal/purchase/publication; concurrent second charge fails; no negative balance |
| Banner moderation | Existing banner tenant enforced; paid pending not public; approved scheduling exact30days; no future recognition; pre-service reject compensated once; mid-service cancel remains gated |
| IDOR | Merchant A cannot read/spend/change destination/request/evidence of B; spoofed staff/admin id ignored; guessed ledger/request UUID does not authorize |
| Finance RBAC | Only active own MANAGER requests; CASHIER/KITCHEN/RIDER denied; FINANCE review only by new explicit grant; ADMIN/SUPPORT no inherited finance privilege; only SUPER_ADMIN confirms PAID |
| Security | Re-auth/CSRF/origin required, private evidence access checked, logs/outbox/API omit secret locator/full account/provider payload; secure cookies unchanged |
| Reconciliation | Balanced journal not enough: missing capture, wrong account, unmatched bank, duplicate reference, residual reserved, subsidy/debt/ad mismatch produce durable cases |
| Corrections | Compensating journal points case/original; one exact full reversal; deletion/history edits forbidden; correct both accounting effect and business source guard |
| Cutover | Existing legacy mode persists; unknown recipient not backfilled; in-flight order vs activation serialized; stale writer rejected; receiver rotation keeps old platform orders pinned |
| Funding backfill | Current campaign classification doesn't change old JSON; old orders/amounts/timestamps intact; no synthetic historical commission |
| Migration | Clean disposable DB and populated copy; expected constraints/indexes/defaults;001–006 files unchanged; no demo finance seed; down refuses after live finance usage |
| Outbox | Order aggregate still valid; finance aggregate XOR; same event per recipient dedupes; provider failure retains event without rolling back completed posting |
| Regression | Existing customer browsing/cart/checkout/payment/auto-upload; merchant/KDS/rider; admin/banners/promotions; lint/build/architecture/full local E2E all pass before enabling finance |

## 8. Verification and delivery boundary

Review results (2026-10-09):

| Check executed | Result |
|---|---|
| npm run db:status --workspace backend | PASS; six completed migrations, pending0 |
| npm run db:verify-local --workspace backend | PASS;36 application tables, existing local seed present |
| Read-only before/after DB catalog comparison | PASS; tables, columns, constraints, indexes and migration history identical |
| Proposal model + Markdown catalog validation | PASS;12 new tables,176 individually documented columns, valid FK target columns;14 local references resolve |
| BigInt accounting/rounding/duration assertions | PASS;29 assertions covering8 required examples, half-up edges and72h/24h duration constants in seconds |
| npm run security:scan | PASS;284 tracked/unignored files, zero findings |
| git -c core.safecrlf=false diff --check | PASS; untracked docs separately checked for whitespace/Markdown structure |
| Before/after repository file hashes | PASS; only these3 requested docs changed, no files added/removed; original audit/source/migrations preserved |
| Application/finance implementation tests | NOT RUN; no finance code/migration exists yet, matrix above is future work |

For THIS review:
- Run migration status and local DB verification as read-only checks.
- Validate table/column catalog consistency and all8 accounting scenarios arithmetically.
- Compare before/after actual DB catalog (tables/columns/constraints/indexes/migrations) and file hashes.
- Run repository secret scan and git diff whitespace check; inspect untracked docs independently.
- Confirm only these3 docs changed by this task; existing dirty files preserved.
- Do not run migration/seed/full app tests and present them as finance validation.

For future implementation: migration tests+full backend+architecture+frontend lint/build+local E2E+secret scan+dependency audit; providers faked in automation.
Manual platform account/QR/slip verification, bank transfer, reconciliation and encrypted-storage recovery only with explicit bounded authorization.
Neither this plan nor README commands constitute authorization to deploy.

Final review must report proposal counts/constraints, legacy backfill/cutover and the2 remaining policy gates, then stop:
```
Migration: NOT CREATED
Application code: UNCHANGED
Cloud: NOT DEPLOYED
Git: NOT COMMITTED / NOT PUSHED
```

