# Finance — current implemented baseline (2026-10-09)

Owner authorized the final sprint and resolved the Confirm Paid gate: mandatory normalized unique transfer reference; optional private proof; actor/time/audit required. Migration 008 and the local Finance implementation now exist.

The current implementation and operator policies are documented in [FINANCE_SPRINT_REPORT.md](FINANCE_SPRINT_REPORT.md). It supersedes older review-only status, migration 007 numbering, full-refund-only restriction, mandatory-proof condition and manual-only settlement described in the archive below.

Current database: migrations 001–008 complete, pending 0, 49 application / 51 public tables. Default remains LEGACY_MERCHANT_DIRECT. No historical financial balances were fabricated. Confirm Paid is SUPER_ADMIN-only after reauthentication. Shared bank-reference uniqueness applies to withdrawal and refund across recipient-version rotation.

## Archived exact review (historical record, not current implementation status)

# Finance / Merchant Settlement — Owner Decisions Locked

**DESIGN REVIEW ONLY · No implementation authorized**  
Updated 2026-10-09. Evidence: [original audit](FINANCE_SETTLEMENT_AUDIT.md); exact proposal: [schema](FINANCE_SCHEMA_PROPOSAL.md); rollout/test gates: [plan](FINANCE_IMPLEMENTATION_PLAN.md).
The 25 Owner decisions below supersede earlier recommendations in these three design documents.
They do not approve a migration, code change, production funds movement or deployment.

## 1. Definitive Owner policy

| # | Locked policy | Application to design |
|---|---|---|
| 1 | Commission default 500 bps / 5% | Initial policy CHECK =500, no merchant rate overrides in phase 1 |
| 2 | Commission base = food subtotal less MERCHANT-funded food discount | Merchant free delivery does not reduce food commission base |
| 3 | PLATFORM-funded discount does not reduce base | Platform bears subsidy separately |
| 4 | Delivery income belongs to merchant; no GP on delivery | Delivery component included in merchant entitlement, never platform commission |
| 5 | All finance money integer satang | BigInt calculation; bigint storage; no float |
| 6 | Follow existing rounding convention | Existing promotion-service half-up: (base*bps+5000)/10000 integer division; use same to 1 satang |
| 7 | Promotion/coupon funding MERCHANT or PLATFORM | Required for new centralized discount usage; copied to immutable order snapshot |
| 8 | No SPLIT initially | No combining funding sources in one discount; preserve existing promo/coupon exclusivity |
| 9 | Minimum withdrawal 30000 satang | Exact bound checked under lock |
| 10 | Maximum NULL/unlimited | No artificial maximum introduced |
| 11 | Withdrawal fee 0 | Requested amount = cash payout |
| 12 | Exactly 72 hours after successful paid_at | 259200 elapsed seconds; not three calendar days |
| 13 | FAILED/REJECTED/CANCELLED do not start cooldown | Only actual successful PAID creates anchor |
| 14 | Post-payout refund → merchant debt/receivable, offset future earnings | Append new debt/recovery postings; never rewrite old payout |
| 15 | Banner fee 30000 satang /30 days | Freeze fee/duration per consent |
| 16 | Debit AVAILABLE after explicit confirmation | Atomic consent+charge; no automatic fee from page visit |
| 17 | Insufficient balance → no active funded purchase | Entire charge/purchase transaction rolls back |
| 18 | MANUAL_WITHDRAWAL first, automatic settlement disabled | No periodic payout creator/bank sender |
| 19 | Payout account change →24-hour withdrawal hold | 86400 seconds after DB-stamped change |
| 20 | Pending withdrawals after account change flagged/reviewed | Original destination stays pinned; review before a new bank action |
| 21 | Only merchant MANAGER requests withdrawal | No CASHIER/KITCHEN/RIDER finance mutation |
| 22 | Admin finance review by permission | Existing role alone does not grant a new action |
| 23 | Confirm payout PAID only super_admin/owner | Actual application role SUPER_ADMIN; do not invent an OWNER enum |
| 24 | Centralized payment only orders after cutover | Explicit immutable per-order route, not inferred from current merchant config |
| 25 | Never rewrite historical order/recipient snapshots | Missing historical identity stays UNKNOWN; never substitute current identity |

Existing rounding evidence: [promotion-service.cjs](../backend/src/promotion-service.cjs) uses BigInt half-up; [payment-money.cjs](../backend/src/payment-money.cjs) parses exact satang.
Existing operational numeric amounts remain unchanged; “all integer money” here applies to proposed finance amounts and computations, not an unauthorized rewrite of migrations001–006.

## 2. Current-state gaps and reuse decisions

Actual catalog has 36 application tables, migrations001–006 complete, pending0 (read-only verification).
There is currently no durable merchant balance/settlement journal.
[Payment service](../backend/src/payment-service.cjs) builds payment identity from merchant configuration; current reports over order totals are not platform revenue.
Historical orders do **not** have a reliable immutable payee identity snapshot. It is unsafe to manufacture one from today's merchant PromptPay.
[Admin auth](../backend/src/admin-auth.cjs) has SUPER_ADMIN/ADMIN/SUPPORT/FINANCE; current FINANCE access does not imply payout confirmation.
Existing staff account/password authentication also does not provide the proposed finance action re-auth/CSRF policy automatically.

Minimal proposal: 12 tables, reuse merchants as lock row, existing orders/payments for route fields, existing campaigns/order JSON for funding, existing banners for creative, existing outbox for durable delivery, audit for actor decisions.
Ledger is a distinct financial authority, not audit JSON or promotion usage counters.
See exact 176 new-table columns +7 added columns in [schema](FINANCE_SCHEMA_PROPOSAL.md).
No balance cache in phase1.

## 3. Money formula and snapshot timing

All symbols below are integer satang; all discount components >=0:

- F = original food subtotal; D = quoted delivery fee.
- Mf/Pf = MERCHANT/PLATFORM-funded food discounts.
- Md/Pd = MERCHANT/PLATFORM-funded delivery discounts.
- Q = customer payment = F+D−Mf−Pf−Md−Pd.
- B = commission base = F−Mf.
- C = commission = floor((B×500+5000)/10000).
- S = platform subsidy = Pf+Pd.
- N = merchant entitlement = F−Mf−C+D−Md.
- **Q = N+C−S**. Delivery is inside N, never counted twice.

Bounds: Mf+Pf<=F, Md+Pd<=D, Q/N>=0. No discount => funding_source NULL.
One discount source => all reductions belong to that source, no SPLIT; zero-value discount can normalize funding to NULL.
Do not recompute an old order from current promotions, coupons, merchant pricing or delivery fees.

At new order creation freeze quote/discount funding in existing operational snapshots plus immutable recipient version.
At first successful platform payment, lock source and merchant; select active immutable finance-policy version; create one financial snapshot and capture journal in the same existing payment transaction.
Initial commission is always500bps; future policy versioning must specify activation timing before changing rates.
No frontend-calculated commission/amount is trusted.
Capture only after existing amount/recipient/unique-reference verification passes. Duplicate payment response reuses result, never creates another snapshot.
Original payment facts remain immutable when a later refund changes payment status.

## 4. Ledger invariants, buckets and posting templates

Every committed financial transaction has >=2 nonzero lines and:

**SUM(debits) = SUM(credits)**, currency THB, source ownership validated.

Authoritative merchant bucket balance = SUM(credits−debits) per merchant account.
PENDING, AVAILABLE, RESERVED and HELD must each remain >=0.
Merchant debt is an asset: SUM(debits−credits) on MERCHANT_DEBT >=0, shown separately, never as negative AVAILABLE.
No merchant.balance column; no API can set balances directly.
The only posting API creates a new journal as a unit; it cannot accept an existing transaction id to append more lines after commit. Repeated event keys return the original result. Equal debit/credit sums alone do not authorize arbitrary postings or historical additions.

| Account | Meaning / normal side |
|---|---|
| CASH_CLEARING / BANK | Verified platform receipt versus reconciled bank custody; debit assets |
| MERCHANT_PENDING | Net earning paid by customer but not yet completed; credit liability |
| MERCHANT_AVAILABLE | Completed and eligible merchant liability; credit, spendable under lock |
| MERCHANT_RESERVED | Pending manual withdrawal claim; credit, not spendable twice |
| MERCHANT_HELD | Disputed/rejected/cancelled amounts awaiting approved resolution; credit |
| MERCHANT_DEBT | Recoverable merchant amount, debit asset; offset future earnings first |
| COMMISSION_DEFERRED | Commission received but not yet earned by completion; credit |
| COMMISSION_REVENUE | Earned GP only; credit |
| SUBSIDY_EXPENSE | Platform-funded benefit cost; debit |
| REFUND_PAYABLE | Approved customer refund awaiting actual outgoing transfer; credit |
| AD_DEFERRED / AD_REVENUE | Unserved advertising credit liability / earned advertising credit revenue |

PENDING/AVAILABLE/RESERVED/HELD are accounts, not a status enum on mutable money.
“Paid out” is a flow metric from confirmed withdrawal postings, not another spendable bucket.
Platform bank balance is not revenue; merchant funds and deferred service are liabilities.
Reconciliation moves Dr BANK / Cr CASH_CLEARING for statement-matched receipts, backed by a STATEMENT_MATCH case and permanent match key per original payment; examples omit this pure asset reclassification. A case cannot reclassify the same receipt twice or more than its original amount.
Bank/clearing require funding/reconciliation controls; never seed imaginary cash to make a report balance.

### Capture template (one atomic transaction)

- Dr CASH_CLEARING Q
- Dr SUBSIDY_EXPENSE S
- Cr MERCHANT_PENDING F
- Dr MERCHANT_PENDING (Mf+Md)
- Cr MERCHANT_PENDING D
- Dr MERCHANT_PENDING C
- Cr COMMISSION_DEFERRED C

Omit zero lines. Total debits Q+S+Mf+Md+C = F+D+C = total credits.
Net merchant PENDING is N. This decomposition exposes gross food, delivery, discounts and fee without adding redundant mutable balance columns.

### Completion / hold / debt

On existing successful COMPLETED transaction:
Dr PENDING N; Cr AVAILABLE N; Dr COMMISSION_DEFERRED C; Cr COMMISSION_REVENUE C.
If merchant owes debt X, first Cr MERCHANT_DEBT min(N,X), and Cr AVAILABLE only N−min(N,X).
Same balanced release transaction, no separate spendable window.
Paid cancellation/rejection: Dr PENDING residual N / Cr HELD N, pending approved refund review; do not auto-mark a bank refund successful.
Refund holds prevent a concurrent payout from spending the affected eligible funds.
Existing order state machine remains unchanged; these are proposed atomic observers only.

### Withdrawal

Reserve: Dr AVAILABLE W / Cr RESERVED W.
Proven failed/rejected/cancelled request: Dr RESERVED W / Cr AVAILABLE W (or Cr debt/HELD if an intervening approved debt/dispute consumes entitlement).
Actual success: Dr RESERVED W / Cr BANK W.
Do not reverse a successful payout to pretend money is back. Only FAILED with proof of non-transfer releases; timeout means UNKNOWN and stays reserved.
One in-flight request per merchant is an additional conservative technical policy, made explicit here; no extra cooldown is imposed.

### Refund and advertising treatment — limited unresolved policies

Owner has locked post-payout debt, not the allocation of every refund component.
**Examples propose FULL reversal of original food/delivery, GP and subsidy**.
Full refund recognition:
Dr PENDING/HELD/AVAILABLE N (or debit MERCHANT_DEBT for already-disbursed shortfall);
Dr COMMISSION_DEFERRED/REVENUE C;
Cr REFUND_PAYABLE Q;
Cr SUBSIDY_EXPENSE S.
Outgoing refund: Dr REFUND_PAYABLE Q / Cr BANK Q.
Recover available unreserved entitlement first; debt for payout shortfall; a reserved unresolved bank transfer cannot be assumed recoverable.
If it later demonstrably fails, release reserved into outstanding debt/hold before AVAILABLE.
Partial refunds and alternative fee retention require a separately approved allocation policy; no silent default.

Banner purchase after consent:
Dr AVAILABLE30000 / Cr AD_DEFERRED30000.
**Proposed recognition**: 1000/day for30 elapsed24h service slices from actual activation: Dr AD_DEFERRED1000 / Cr AD_REVENUE1000.
Reject before service: one typed AD_REFUND, Dr AD_DEFERRED30000 / Cr merchant debt/HELD if applicable before AVAILABLE. This full compensating refund is not the generic exact-inverse REVERSAL when debt/hold changes the destination account; its permanent event key is ad:{uuid}:refund.
Mid-service cancellation/proration needs policy approval. No recognition during mere pending moderation.
Calendar display uses local time; proposed service duration is exactly2592000 elapsed seconds.

## 5. Required accounting examples (all amounts SATANG)

Cases1–5 assume completion and no hold/debt; “available” is after completion, pending is just after payment.
Revenue column means earned GP on completion; capture alone creates deferred GP.

| Case | F | D | Mf | Pf | Md | Pd | Customer pays Q | Pending N | Commission C | Subsidy S | Available after completion | Platform earned GP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 No discount | 10000 | 1500 | 0 | 0 | 0 | 0 | 11500 | 11000 | 500 | 0 | 11000 | 500 |
| 2 Merchant food discount | 20000 | 1500 | 2000 | 0 | 0 | 0 | 19500 | 18600 | 900 | 0 | 18600 | 900 |
| 3 Platform food discount | 20000 | 1500 | 0 | 2000 | 0 | 0 | 19500 | 20500 | 1000 | 2000 | 20500 | 1000 |
| 4 Merchant free delivery | 10000 | 1500 | 0 | 0 | 1500 | 0 | 10000 | 9500 | 500 | 0 | 9500 | 500 |
| 5 Platform free delivery | 10000 | 1500 | 0 | 0 | 0 | 1500 | 10000 | 11000 | 500 | 1500 | 11000 | 500 |

Gross GP is not net platform result: before other costs case3 =1000−2000=−1000, case5 =500−1500=−1000.

Exact capture journal per case (MP=MERCHANT_PENDING, CD=COMMISSION_DEFERRED):

| Case | Debits | Credits | SUM Dr = SUM Cr |
|---|---|---|---:|
| 1 | CASH_CLEARING11500; MP500 | MP food10000; MP delivery1500; CD500 | 12000 |
| 2 | CASH_CLEARING19500; MP merchant discount2000; MP commission900 | MP food20000; MP delivery1500; CD900 | 22400 |
| 3 | CASH_CLEARING19500; SUBSIDY_EXPENSE2000; MP1000 | MP food20000; MP delivery1500; CD1000 | 22500 |
| 4 | CASH_CLEARING10000; MP free delivery1500; MP commission500 | MP food10000; MP delivery1500; CD500 | 12000 |
| 5 | CASH_CLEARING10000; SUBSIDY_EXPENSE1500; MP500 | MP food10000; MP delivery1500; CD500 | 12000 |

For each completion, Dr MP N+Dr CD C = Cr AVAILABLE N+Cr COMMISSION_REVENUE C.
Thus respectively completion totals11500,19500,21500,10000,11500 on each side.

### Case6 — full refund before payout (proposed full-reversal policy)

Use completed case1, no withdrawal yet.
Original customer paid11500; pending0, available11000, earned commission500, subsidy0.
Recognition Dr AVAILABLE11000 +Dr COMMISSION_REVENUE500 =Cr REFUND_PAYABLE11500.
Then Dr REFUND_PAYABLE11500 =Cr BANK11500 on confirmed customer refund.
After: pending0, available0, commission/revenue0, subsidy0, debt0; customer's net paid0.
If refund occurs before completion, debit PENDING/HELD and COMMISSION_DEFERRED instead, same amounts.
Original snapshot/receipt11500 remains unchanged.

### Case7 — full refund after payout → debt (proposed full-reversal policy)

Use case1 after merchant received11000 via reserved→paid; pending0, available0, revenue500.
Recognition Dr MERCHANT_DEBT11000 +Dr COMMISSION_REVENUE500 =Cr REFUND_PAYABLE11500.
Then Dr REFUND_PAYABLE11500 =Cr BANK11500.
After: customer net paid0; pending0/available0, commission/revenue0, subsidy0, debt11000.
Historical merchant payout remains11000; it is not marked failed or rewritten.
Refund cash requires platform liquidity: original receipt11500−merchant payout11000−refund11500 =−11000 without other funding.
Do not create negative AVAILABLE to conceal the shortfall or pretend refund was paid before cash exists.

Next merchant completed entitlement8000:
Dr PENDING8000 / Cr MERCHANT_DEBT8000; available remains0, debt3000.
Following entitlement5000:
Dr PENDING5000 / Cr MERCHANT_DEBT3000 +Cr AVAILABLE2000; debt0.
Their own commission recognition follows original snapshots independently.

### Case8 — banner30000 from AVAILABLE

Start derived AVAILABLE50000, pending0, unrelated debt0; customer pays0 for this operation.
No commission or subsidy: C0/S0. Explicit consent posts Dr AVAILABLE30000 =Cr AD_DEFERRED30000.
After: available20000, pending0; no new cash receipt; platform earned ad revenue0 initially.
Under proposed daily recognition, Dr AD_DEFERRED1000 =Cr AD_REVENUE1000 each served day, final ad revenue30000 after30 days.
A available29999 request produces no purchase, no journal, no published ad.
This is a transfer of merchant liability into advertising service liability, not GP on a delivery order.

## 6. Withdrawal concurrency and account security

Design SQL outline below is explanatory, **not an executable migration**.
Isolation READ COMMITTED with required row locks; recompute balances in a subsequent statement after lock acquisition.
All finance writers use same order: merchant ids ascending → source order/payment if relevant → withdrawal/refund/ad → account/banner rows.
Existing operational transactions must adopt this lock order in implementation; mixing order→merchant and merchant→order would deadlock.

```sql
BEGIN;
SELECT id, payout_account_changed_at FROM merchants
WHERE id = :authenticated_merchant_id FOR UPDATE;
-- Validate active MANAGER membership/session and re-auth/CSRF.
-- If existing (merchant_id,idempotency_key), compare fingerprint and return original.
SELECT * FROM merchant_payout_accounts
WHERE merchant_id = :merchant_id AND is_current FOR UPDATE;
SELECT max(paid_at) FROM merchant_withdrawals
WHERE merchant_id = :merchant_id AND status = 'PAID';
-- DB now = clock_timestamp(); verify now >= last_paid_at + interval '72 hours'
-- and now >= payout_account_changed_at + interval '24 hours'.
-- UTC session / equivalent epoch seconds required, not local-date comparison.
SELECT coalesce(sum(CASE side WHEN 'C' THEN amount_satang
                         ELSE -amount_satang END),0)
FROM financial_postings p JOIN financial_accounts a ON a.id = p.account_id
WHERE a.merchant_id = :merchant_id AND a.kind = 'MERCHANT_AVAILABLE';
-- Require amount >=30000, max NULL, fee0; no unresolved debt/hold blocking spend.
-- Require verified current destination, no in-flight withdrawal.
-- INSERT request + permanent key/fingerprint; post Dr AVAILABLE / Cr RESERVED.
-- Insert outbox and audit in same transaction; deferred invariants at commit.
COMMIT;
```

Use DB epoch-seconds comparison or UTC timestamptz interval; boundary equality is allowed.
50000 AVAILABLE with two concurrent40000 requests: first reserves40000; second sees in-flight or only10000 and fails, never−30000.
Advert purchase/refund hold/completion/debt offset also lock merchant first; balance read without this shared lock is insufficient.
Do not use SKIP LOCKED for a customer's withdrawal amount check.
Unique constraints remain necessary for retries; row lock alone is not durable idempotency.
Deadlock/serialization retries reuse same normalized key/fingerprint and never retry an uncertain bank action.

Successful paid_at = immutable DB confirmation timestamp, separate from bank_executed_at evidence.
Account initial registration and every accepted change/activation conservatively start24h hold, never shorten it.
Changing payout account flags REQUESTED/APPROVED/PROCESSING rows and preserves old payout_account_id.
Permissioned reviewer must inspect pinned destination and latest account-change timestamp before clearing flag.
New execution requires both no flag and hold expiry. Approval/review alone does not bypass hold.
Changing back to an old account does not bypass a newer change timestamp.

If bank already executed before account change, do not hide the true transfer while waiting24h.
Block further execution; require SUPER_ADMIN evidence review/reconciliation and record factual result with audit CONTROL_EXCEPTION if needed.
UNKNOWN execution is never “cancelled” merely to release funds.
Withdrawal FAILED/REJECTED/CANCELLED have paid_at NULL and do not advance72h; genuine PAID still controls subsequent eligibility.
The bank reference namespace is shared between refund/payout and pinned to a stable canonical debit account across credential rotation.

## 7. Finance permissions / notifications

| Actor | Allowed initial finance actions | Forbidden |
|---|---|---|
| MANAGER (own merchant) | Read own balances/history, submit/change payout account, request/cancel unprocessed withdrawal, explicit ad consent | Other tenants, set balance, approve own bank verification, confirm PAID |
| CASHIER/KITCHEN/RIDER | Existing operational access unchanged | Finance mutation and private account/statement data; hide finance navigation |
| FINANCE with new explicit review permission | Review finance records/account evidence, approve/reject within assigned scope, reconcile exceptions | Confirm payout PAID or bank result without SUPER_ADMIN permission |
| ADMIN/SUPPORT | Existing grants only | Implicit finance access based on role name |
| SUPER_ADMIN | Explicit payment-confirm permission + re-auth + evidence review | Bypass ledger/source/amount/hold constraints or overwrite history |

No automatic assignment of finance permissions just because current role is named FINANCE.
Use tenant checks on every account/request/journal query; masked identifiers by default; private evidence access short-lived and audited.
Finance mutations require session authentication, CSRF/origin enforcement and recent password re-auth as future work; no new auth code in this review.
Existing LINE outbox reused with financial_transaction_id, payload allowlist, recipient-specific dedupe.
Delivery failures do not roll back posted journal; no bank identifiers/full evidence in LINE or logs.
Success/failure decisions without money movement go to audit_logs; a new standalone notification table is unnecessary.
Automatic bank payout and auto-settlement remain disabled.

## 8. Exact cutover and historical safety

Modes:
- LEGACY_DIRECT + recipient_version_id NULL: pre-cutover merchant custody, historical recipient unknown unless actual immutable external evidence exists. No platform ledger manufactured.
- PLATFORM + non-null recipient version on BOTH order and payment: post-cutover platform custody, verified using pinned encrypted configuration.

Do not use current merchant PromptPay, latest receiver pointer, order ID threshold or client-created timestamp to reinterpret an existing order.

1. Add reviewed schema with feature disabled; old rows default LEGACY_DIRECT/NULL. No monetary backfill.
2. Deploy future route-aware writers/verifiers to all instances while cutover stays disabled. Old incompatible workers must be drained; a DB route guard rejects a legacy insert once centralized mode is enabled.
3. Create immutable platform receiver version, verify it and all manual provider settings; old versioned identities must remain resolvable.
4. Set explicit funding_source for eligible CURRENT promotions/coupons with audit; old order JSON untouched. Unresolved current offers cannot enter new centralized quotes.
5. **Gate activation on clearing/reviewing legacy unpaid orders with unknown recipient.** Stop creating legacy checkouts during controlled cutover window; drain pending payments. Do not silently regenerate their QR to platform. Unknown/ambiguous remaining orders require manual legacy resolution before enabling cutover, not guessed recipient backfill.
6. Use one existing private system_settings entry finance.runtime (JSON object: enabled=false/true, policy_version_id, recipient_version_id, cutover_at, settlement_mode=MANUAL_WITHDRAWAL). Validate referenced rows in guarded configuration writer. No secret values.
7. Future order transaction locks that settings row FOR SHARE BEFORE merchant/source locks and freezes mode/receiver. Activation takes FOR UPDATE, waits for all pre-cutover creation transactions, records DB clock cutover_at and enables PLATFORM atomically. Existing legacy writer is prohibited by route guard. Settings writer must not acquire merchant locks in reverse order.
8. After activation every newly admitted order pins PLATFORM. Existing legacy records remain legacy forever. Payment attempt copies version; old platform QR/verification resolves original version even after pointer rotation. Mode and receiver cannot be changed after order creation.
9. For legacy PAID history, browsing/reporting remains intact and separate from platform balance/revenue. Do not use historical amounts for opening balances or GP.
10. If finance cutover must be paused, block NEW centralized orders rather than routing a customer's existing platform order to merchant account. Keep verification, reconciliation and obligations for existing platform orders running. A return to legacy creation requires an explicit new operational cutover decision.

All this is a future rollout design; no existing customer/payment/staff behavior changed now.

## 9. Reconciliation and remaining enablement gates

Daily checks:
- Every transaction balances; all posting accounts match currency/source tenant.
- Platform captured payment ↔ snapshot ↔ unique capture journal; no legacy capture.
- Merchant total liabilities = pending+available+reserved+held; no negative bucket; debt separate.
- Each RESERVED claim matches exactly one in-flight withdrawal less confirmed dispositions.
- Completed/rejected order finance state matches release/hold event exactly once.
- Confirmed bank references unique across withdrawals/refunds; total outbound evidence matches journal.
- Approved refunds tie original amounts and paid transfers; unrecovered debt matches offset postings.
- Advertising debit/deferred/earned/reversed balance reconciles to approved service windows.
- Bank statements, clearing and known funding match cash movements; unposted statements/UNKNOWN transfers create exception cases.
- Active campaign funding resolved; current reports never relabel customer total as GP.

Reconciliation reads a consistent REPEATABLE READ snapshot; successful run summary+private report are retained through existing audit_logs.
Differences become finance_reconciliation_cases with immutable observed evidence. SUPER_ADMIN-approved correcting journal references case; no edit/rebuild of original finance facts.
No application claim that this review establishes tax/legal compliance; this is an application architecture proposal, not legal advice.

Only two extra policy questions remain: full-refund component reversal; ad earned-revenue/proration/cancellation.
Owner's25 decisions are not reopened. Secret custody, bank evidence namespace and actual provider testing remain operational gates.
```
Migration: NOT CREATED
Application code: UNCHANGED
Cloud: NOT DEPLOYED
Git: NOT COMMITTED / NOT PUSHED
```

