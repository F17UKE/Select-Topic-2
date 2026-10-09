# Finance — current implemented baseline (2026-10-09)

Owner authorized the final sprint and resolved the Confirm Paid gate: mandatory normalized unique transfer reference; optional private proof; actor/time/audit required. Migration 008 and the local Finance implementation now exist.

The current implementation and operator policies are documented in [FINANCE_SPRINT_REPORT.md](FINANCE_SPRINT_REPORT.md). It supersedes older review-only status, migration 007 numbering, full-refund-only restriction, mandatory-proof condition and manual-only settlement described in the archive below.

Current database: migrations 001–008 complete, pending 0, 49 application / 51 public tables. Default remains LEGACY_MERCHANT_DIRECT. No historical financial balances were fabricated. Confirm Paid is SUPER_ADMIN-only after reauthentication. Shared bank-reference uniqueness applies to withdrawal and refund across recipient-version rotation.

The implemented catalog has 12 new tables and 149 columns. Full columns, types, PK/FK/UNIQUE/CHECK constraints, indexes and trigger bindings: [FINANCE_SCHEMA_IMPLEMENTED.md](FINANCE_SCHEMA_IMPLEMENTED.md). Existing-table additions total 7 columns across 5 tables; system_settings receives one private row. No notification_outbox schema change was needed.

## Archived exact review (historical record, not current implementation status)

# Finance / Merchant Settlement — Exact Schema Proposal

**REVIEW ONLY · Owner policies locked · schema implementation NOT authorized**  
Updated 2026-10-09; local catalog inspected 2026-10-08. Read [Design](FINANCE_SETTLEMENT_DESIGN.md) and [Implementation plan](FINANCE_IMPLEMENTATION_PLAN.md).
This replaces the earlier conceptual 14-table proposal. [Original audit](FINANCE_SETTLEMENT_AUDIT.md) remains evidence of the pre-finance application, not approval to migrate.

## 1. Verified baseline and minimum scope

Current local database: 36 application tables plus 2 Knex tables; migrations 001–006 complete, pending 0.
Read-only catalog inspection includes columns, constraints and indexes. No finance table exists.
Proposed: **12 new tables / 176 columns**, **7 existing tables altered / 7 new columns**.
Total proposed new columns: **183**. There is no merchant.balance or cached authoritative balance.

| Existing tables (all 36 accounted for) | Reuse / disposition |
|---|---|
| merchants | Tenant and serialization row; one new payout-account-change timestamp |
| orders, payments | Existing operational/payment records; immutable centralized route version added, not duplicate orders/payments |
| promotions, coupons | One funding_source column each; use existing order promotion_snapshot/coupon_snapshot |
| promotion_redemptions, coupon_redemptions | Existing quota/history; no financial amount reconstruction from current campaigns |
| banners | Existing creative, image, moderation, schedule; only add composite unique key |
| notification_outbox | Existing delivery/retry/dedupe; add ledger-transaction aggregate |
| system_settings | Audited private active policy/recipient/cutover pointers; no credentials, no DDL |
| audit_logs | Actor/security decisions and reconciliation-run summaries; NOT money ledger |
| merchant_staffs, platform_admins, platform_admin_sessions | Existing identity, tenancy and permissions; no role/schema additions |
| customers, customer_addresses, customer_favorite_merchants, customer_notifications | Unchanged; do not use customer notification records for merchant finance |
| delivery_fees, dormitories, sois | Unchanged |
| menu_categories, menu_items, menu_option_choices, menu_option_groups | Unchanged |
| merchant_images, merchant_opening_hours | Unchanged |
| order_chat_read_states, order_item_choices, order_items, order_messages | Unchanged |
| payment_slips, payment_verifications | Existing private payment proof; no plaintext provider copies into finance |
| idempotency_keys | Existing customer order HTTP result cache; permanent finance keys below survive cache expiry |
| line_webhook_events, reviews | Unchanged |

No merchant_finance_profiles: lock existing merchants row. No order_payment_routes: typed columns on orders/payments.
No separate payout-attempt/refund-transfer tables: shared finance_transfers prevents reusing bank references across both.
No reconciliation_runs table: immutable private report + audit_logs summary for successful runs, durable exception cases below.

## 2. Exact conventions

- One row below means one column; no implied columns. N = NOT NULL, Y = nullable.
- Default “—” means **no database DEFAULT**, writer must supply; NULL means DEFAULT NULL.
- bigint IDs use GENERATED ALWAYS AS IDENTITY; UUIDs supplied by server crypto.randomUUID(), no new extension.
- All new money columns are bigint satang; JSON/API renders bigint as decimal strings. Existing numeric(12,2) food/payment fields remain unchanged and are converted exactly using the existing strict money parser.
- All timestamps are timestamptz; session timezone UTC. Fixed holds are seconds (86400/259200), never local calendar arithmetic. No auto-update convention is implied: a guard stamps updated_at = clock_timestamp() on allowed mutations.
- PK/UNIQUE/CHECK/index names below are proposed exact names. Every PK/UQ creates its own B-tree index. Explicit indexes below are B-tree; default ascending unless stated.
- All NEW foreign keys: ON DELETE RESTRICT ON UPDATE RESTRICT, MATCH SIMPLE, NOT DEFERRABLE. Nullable composite relationships get cross-row equality guards as specified; null is not a loophole for a platform payment.
- Existing outbox order FK/cascade is preserved; new finance FK uses RESTRICT. Referenced platform orders/payments cannot be deleted because journal/snapshot FKs prohibit it.
- F = finance-restricted operational data; P = displayable non-sensitive text; M = masked personal data; S = restricted secret/evidence locator. A locator is not a secret value, but is never public/logged. No plaintext full bank numbers, national IDs, holder names, tokens or signed URLs are proposed.
- JSONB only on EXISTING order/outbox/settings/audit fields; allowlist finance metadata. Sensitive full account/holder data lives in versioned encrypted storage via S refs, with separate access grants, immutable versions and private evidence.
- New checks intentionally lock phase-1 policy. A later changed commission/fee/policy needs explicit review rather than silently bypassing CHECKs.
- All new table DELETE forbidden to normal application role; immutable fields protected by triggers and grants. Financial tables have no cascading retention. Evidence access/retention does not erase ledger.
- Schema blocks are design declarations, not a migration file or executed SQL.

## 3. Existing tables: exact proposed changes

| Table | New column | PostgreSQL type | Null | Default | Meaning / classification |
|---|---|---|---|---|---|
| merchants | payout_account_changed_at | timestamptz | Y | NULL | F; DB-stamped latest accepted payout-account change/activation; derive 24h hold |
| orders | collection_mode | varchar(24) | N | 'LEGACY_DIRECT' | F; deterministic grandfathering |
| orders | payment_recipient_version_id | uuid | Y | NULL | F; immutable platform recipient version |
| payments | payment_recipient_version_id | uuid | Y | NULL | F; pinned same version as its order |
| promotions | funding_source | varchar(16) | Y | NULL | F; MERCHANT or PLATFORM; NULL = unresolved legacy |
| coupons | funding_source | varchar(16) | Y | NULL | F; MERCHANT or PLATFORM; NULL = unresolved legacy |
| notification_outbox | financial_transaction_id | bigint | Y | NULL | F; durable finance-event source |

Additional nullability alteration: notification_outbox.order_id becomes nullable; same integer type, existing default and existing order FK unchanged.
No other existing columns change type/default. No money backfill or historical snapshot rewrite.

Exact additional declarations:

- merchants: no new PK/FK/UQ/CHECK/index; existing id PK is lock target. Guard prevents callers backdating/clearing payout_account_changed_at.
- orders:
  - FK orders_finance_recipient_fk (payment_recipient_version_id) REFERENCES platform_payment_recipients(id).
  - UNIQUE orders_finance_recipient_uq (id,payment_recipient_version_id).
  - CHECK orders_collection_mode_ck: `(collection_mode = 'LEGACY_DIRECT' AND payment_recipient_version_id IS NULL) OR (collection_mode = 'PLATFORM' AND payment_recipient_version_id IS NOT NULL)`.
  - INDEX orders_finance_recipient_idx (payment_recipient_version_id).
  - INDEX orders_finance_mode_created_idx (collection_mode,created_at).
  - Existing UNIQUE(id,merchant_id) reused.
- payments:
  - UNIQUE payments_finance_order_uq (id,order_id).
  - FK payments_finance_route_fk (order_id,payment_recipient_version_id) REFERENCES orders(id,payment_recipient_version_id).
  - INDEX payments_finance_route_idx (order_id,payment_recipient_version_id).
  - No added row-local CHECK can prove parent route; route guard below is mandatory.
- promotions: CHECK promotions_funding_ck `funding_source IS NULL OR funding_source IN ('MERCHANT','PLATFORM')`; no additional FK/UQ/index.
- coupons: CHECK coupons_funding_ck `funding_source IS NULL OR funding_source IN ('MERCHANT','PLATFORM')`; no additional FK/UQ/index.
- banners: UNIQUE banners_finance_merchant_uq (id,merchant_id); no new column/FK/CHECK/index beyond this UQ.
- notification_outbox:
  - FK notification_outbox_finance_fk (financial_transaction_id) REFERENCES financial_transactions(id).
  - CHECK notification_outbox_finance_source_ck `num_nonnulls(order_id,financial_transaction_id) = 1`.
  - INDEX notification_outbox_finance_idx (financial_transaction_id).
  - Existing dedupe_key uniqueness retained. A finance event concerning an order uses the finance aggregate only, never both columns.

Funding is mutable on current campaign rows only for future orders and audited; freeze it in existing order discount JSON when pricing is accepted.
Null legacy funding cannot produce a centralized paid snapshot; SPLIT is rejected.
Reuse existing no-stacked-promotion/coupon policy, do not redesign checkout.

## 4. New tables — complete column/constraint catalog

### 4.1 finance_policy_versions (15 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | bigint | N | GENERATED ALWAYS AS IDENTITY | PK | F |
| version | varchar(40) | N | — | Unique policy identifier | F |
| commission_bps | integer | N | 500 | Default; phase 1 fixed 500 | F |
| calculation_version | varchar(40) | N | 'FINANCE_V1' | Food less merchant food discount; HALF_UP | F |
| minimum_withdrawal_satang | bigint | N | 30000 | Typed business value; constraints below | F |
| maximum_withdrawal_satang | bigint | Y | NULL | Unlimited | F |
| withdrawal_fee_satang | bigint | N | 0 | Typed business value; constraints below | F |
| withdrawal_cooldown_seconds | integer | N | 259200 | Typed business value; constraints below | F |
| account_hold_seconds | integer | N | 86400 | Typed business value; constraints below | F |
| advertising_fee_satang | bigint | N | 30000 | Typed business value; constraints below | F |
| advertising_duration_days | integer | N | 30 | Typed business value; constraints below | F |
| settlement_mode | varchar(24) | N | 'MANUAL_WITHDRAWAL' | Typed business value; constraints below | F |
| approved_by_admin_id | integer | N | — | Typed business value; constraints below | F |
| effective_from | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `finance_policy_versions_pk (id)`.

**UNIQUE constraints:**

- `finance_policy_versions_uq_1 (version)`.

**FKs** (RESTRICT / RESTRICT):

- `finance_policy_versions_fk_1 (approved_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `finance_policy_versions_ck_1`: `length(btrim(version)) > 0`.
- `finance_policy_versions_ck_2`: `commission_bps = 500 AND calculation_version = 'FINANCE_V1'`.
- `finance_policy_versions_ck_3`: `minimum_withdrawal_satang = 30000 AND maximum_withdrawal_satang IS NULL AND withdrawal_fee_satang = 0`.
- `finance_policy_versions_ck_4`: `withdrawal_cooldown_seconds = 259200 AND account_hold_seconds = 86400`.
- `finance_policy_versions_ck_5`: `advertising_fee_satang = 30000 AND advertising_duration_days = 30`.
- `finance_policy_versions_ck_6`: `settlement_mode = 'MANUAL_WITHDRAWAL'`.

**Additional indexes:**

- `finance_policy_versions_idx_1`: `(effective_from,id)`.
- `finance_policy_versions_idx_2`: `(approved_by_admin_id)`.

**Mutation/security policy:** Append-only; no UPDATE/DELETE. Future terms create version only after explicit policy/schema review; initial CHECKs deliberately enforce locked phase-1 values.

### 4.2 platform_payment_recipients (10 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| version | varchar(40) | N | — | Typed business value; constraints below | F |
| rail | varchar(20) | N | 'PROMPTPAY' | Typed business value; constraints below | F |
| identity_type | varchar(24) | N | — | PHONE / NATIONAL_ID / EWALLET | F |
| display_name | varchar(120) | N | — | Public payee display | P |
| masked_identity | varchar(40) | N | — | Masked tail only | M |
| identity_secret_ref | varchar(512) | N | — | Immutable versioned external secret reference; never the account itself | S |
| verification_secret_ref | varchar(512) | N | — | Versioned exact provider recipient account configuration | S |
| created_by_admin_id | integer | N | — | Typed business value; constraints below | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `platform_payment_recipients_pk (id)`.

**UNIQUE constraints:**

- `platform_payment_recipients_uq_1 (version)`.

**FKs** (RESTRICT / RESTRICT):

- `platform_payment_recipients_fk_1 (created_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `platform_payment_recipients_ck_1`: `length(btrim(version)) > 0`.
- `platform_payment_recipients_ck_2`: `rail = 'PROMPTPAY'`.
- `platform_payment_recipients_ck_3`: `identity_type IN ('PHONE','NATIONAL_ID','EWALLET')`.
- `platform_payment_recipients_ck_4`: `length(btrim(display_name)) > 0 AND length(btrim(masked_identity)) > 0`.
- `platform_payment_recipients_ck_5`: `length(btrim(identity_secret_ref)) > 0 AND length(btrim(verification_secret_ref)) > 0`.

**Additional indexes:**

- `platform_payment_recipients_idx_1`: `(created_by_admin_id)`.

**Mutation/security policy:** Immutable version rows. New version on rotation; never overwrite secret versions. Activation is an audited system_settings pointer; old referenced secrets retained. Masking/secret-reference format validated by service, no full account in logs/JSON.

### 4.3 order_financial_snapshots (21 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| order_id | integer | N | — | PK | F |
| merchant_id | integer | N | — | Typed business value; constraints below | F |
| paid_payment_id | integer | N | — | Typed business value; constraints below | F |
| recipient_version_id | uuid | N | — | Typed business value; constraints below | F |
| policy_version_id | bigint | N | — | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| food_subtotal_satang | bigint | N | — | Immutable satang basis | F |
| delivery_fee_satang | bigint | N | — | Immutable satang basis | F |
| merchant_food_discount_satang | bigint | N | — | Immutable satang basis | F |
| platform_food_discount_satang | bigint | N | — | Immutable satang basis | F |
| merchant_delivery_discount_satang | bigint | N | — | Immutable satang basis | F |
| platform_delivery_discount_satang | bigint | N | — | Immutable satang basis | F |
| customer_paid_satang | bigint | N | — | Immutable satang basis | F |
| commission_base_satang | bigint | N | — | Immutable satang basis | F |
| commission_satang | bigint | N | — | Immutable satang basis | F |
| platform_subsidy_satang | bigint | N | — | Immutable satang basis | F |
| merchant_entitlement_satang | bigint | N | — | Immutable satang basis | F |
| commission_bps | integer | N | 500 | Typed business value; constraints below | F |
| funding_source | varchar(16) | Y | NULL | NULL only when discount = 0 | F |
| paid_at | timestamptz | N | — | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `order_financial_snapshots_pk (order_id)`.

**UNIQUE constraints:**

- `order_financial_snapshots_uq_1 (paid_payment_id)`.
- `order_financial_snapshots_uq_2 (order_id,merchant_id)`.

**FKs** (RESTRICT / RESTRICT):

- `order_financial_snapshots_fk_1 (order_id,merchant_id) REFERENCES orders(id,merchant_id)`.
- `order_financial_snapshots_fk_2 (paid_payment_id,order_id) REFERENCES payments(id,order_id)`.
- `order_financial_snapshots_fk_3 (order_id,recipient_version_id) REFERENCES orders(id,payment_recipient_version_id)`.
- `order_financial_snapshots_fk_4 (policy_version_id) REFERENCES finance_policy_versions(id)`.

**CHECKs:**

- `order_financial_snapshots_ck_1`: `currency = 'THB' AND commission_bps = 500`.
- `order_financial_snapshots_ck_2`: `food_subtotal_satang >= 0`.
- `order_financial_snapshots_ck_3`: `delivery_fee_satang >= 0`.
- `order_financial_snapshots_ck_4`: `merchant_food_discount_satang >= 0`.
- `order_financial_snapshots_ck_5`: `platform_food_discount_satang >= 0`.
- `order_financial_snapshots_ck_6`: `merchant_delivery_discount_satang >= 0`.
- `order_financial_snapshots_ck_7`: `platform_delivery_discount_satang >= 0`.
- `order_financial_snapshots_ck_8`: `customer_paid_satang >= 0`.
- `order_financial_snapshots_ck_9`: `commission_base_satang >= 0`.
- `order_financial_snapshots_ck_10`: `commission_satang >= 0`.
- `order_financial_snapshots_ck_11`: `platform_subsidy_satang >= 0`.
- `order_financial_snapshots_ck_12`: `merchant_entitlement_satang >= 0`.
- `order_financial_snapshots_ck_13`: `merchant_food_discount_satang + platform_food_discount_satang <= food_subtotal_satang`.
- `order_financial_snapshots_ck_14`: `merchant_delivery_discount_satang + platform_delivery_discount_satang <= delivery_fee_satang`.
- `order_financial_snapshots_ck_15`: `customer_paid_satang = food_subtotal_satang + delivery_fee_satang - merchant_food_discount_satang - platform_food_discount_satang - merchant_delivery_discount_satang - platform_delivery_discount_satang`.
- `order_financial_snapshots_ck_16`: `commission_base_satang = food_subtotal_satang - merchant_food_discount_satang`.
- `order_financial_snapshots_ck_17`: `commission_satang = floor((commission_base_satang::numeric * commission_bps + 5000) / 10000)::bigint`.
- `order_financial_snapshots_ck_18`: `platform_subsidy_satang = platform_food_discount_satang + platform_delivery_discount_satang`.
- `order_financial_snapshots_ck_19`: `merchant_entitlement_satang = food_subtotal_satang - merchant_food_discount_satang - commission_satang + delivery_fee_satang - merchant_delivery_discount_satang`.
- `order_financial_snapshots_ck_20`: `customer_paid_satang = merchant_entitlement_satang + commission_satang - platform_subsidy_satang`.
- `order_financial_snapshots_ck_21`: `((funding_source IS NULL AND merchant_food_discount_satang + platform_food_discount_satang + merchant_delivery_discount_satang + platform_delivery_discount_satang = 0) OR (funding_source IS NOT NULL AND funding_source IN ('MERCHANT','PLATFORM') AND merchant_food_discount_satang + platform_food_discount_satang + merchant_delivery_discount_satang + platform_delivery_discount_satang > 0 AND ((funding_source = 'MERCHANT' AND platform_subsidy_satang = 0) OR (funding_source = 'PLATFORM' AND merchant_food_discount_satang + merchant_delivery_discount_satang = 0))))`.

**Additional indexes:**

- `order_financial_snapshots_idx_1`: `(merchant_id,paid_at)`.
- `order_financial_snapshots_idx_2`: `(paid_payment_id,order_id)`.
- `order_financial_snapshots_idx_3`: `(order_id,recipient_version_id)`.
- `order_financial_snapshots_idx_4`: `(policy_version_id)`.

**Mutation/security policy:** Append-only at successful platform PAID transaction. paid_at copied from original payment, not default clock in writer. No legacy snapshots invented. Guard validates amounts/discount funding against locked order and original normalized payment, not mutable campaigns.

### 4.4 financial_accounts (5 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | bigint | N | GENERATED ALWAYS AS IDENTITY | PK | F |
| merchant_id | integer | Y | NULL | Typed business value; constraints below | F |
| kind | varchar(32) | N | — | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `financial_accounts_pk (id)`.

**UNIQUE constraints:**

None beyond PK (partial unique indexes, if any, below).

**FKs** (RESTRICT / RESTRICT):

- `financial_accounts_fk_1 (merchant_id) REFERENCES merchants(id)`.

**CHECKs:**

- `financial_accounts_ck_1`: `currency = 'THB'`.
- `financial_accounts_ck_2`: `((merchant_id IS NOT NULL AND kind IN ('MERCHANT_PENDING','MERCHANT_AVAILABLE','MERCHANT_RESERVED','MERCHANT_HELD','MERCHANT_DEBT')) OR (merchant_id IS NULL AND kind IN ('CASH_CLEARING','BANK','COMMISSION_DEFERRED','COMMISSION_REVENUE','SUBSIDY_EXPENSE','REFUND_PAYABLE','AD_DEFERRED','AD_REVENUE')))`.

**Additional indexes:**

- `financial_accounts_idx_1`: UNIQUE `(merchant_id,kind,currency) WHERE merchant_id IS NOT NULL`.
- `financial_accounts_idx_2`: UNIQUE `(kind,currency) WHERE merchant_id IS NULL`.
- `financial_accounts_idx_3`: `(merchant_id)`.

**Mutation/security policy:** Immutable identity/classification. No stored balance. Merchant liability buckets credit-normal; MERCHANT_DEBT debit-normal asset. Cash/debt/expense debit-normal; deferred/revenue/refund payable credit-normal. Ledger may not mix currencies.

### 4.5 financial_transactions (13 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | bigint | N | GENERATED ALWAYS AS IDENTITY | PK | F |
| event_key | varchar(180) | N | — | Typed business value; constraints below | F |
| fingerprint | char(64) | N | — | SHA-256 canonical immutable posting intent | F |
| kind | varchar(32) | N | — | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| order_id | integer | Y | NULL | Typed business value; constraints below | F |
| withdrawal_id | uuid | Y | NULL | Typed business value; constraints below | F |
| refund_id | uuid | Y | NULL | Typed business value; constraints below | F |
| advertising_order_id | uuid | Y | NULL | Typed business value; constraints below | F |
| reconciliation_case_id | uuid | Y | NULL | Typed business value; constraints below | F |
| reverses_transaction_id | bigint | Y | NULL | Full exact inverse only | F |
| created_by_admin_id | integer | Y | NULL | NULL = trusted system posting | F |
| posted_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `financial_transactions_pk (id)`.

**UNIQUE constraints:**

- `financial_transactions_uq_1 (event_key)`.
- `financial_transactions_uq_2 (reverses_transaction_id)`.

**FKs** (RESTRICT / RESTRICT):

- `financial_transactions_fk_1 (order_id) REFERENCES order_financial_snapshots(order_id)`.
- `financial_transactions_fk_2 (withdrawal_id) REFERENCES merchant_withdrawals(id)`.
- `financial_transactions_fk_3 (refund_id) REFERENCES finance_refunds(id)`.
- `financial_transactions_fk_4 (advertising_order_id) REFERENCES advertising_orders(id)`.
- `financial_transactions_fk_5 (reconciliation_case_id) REFERENCES finance_reconciliation_cases(id)`.
- `financial_transactions_fk_6 (reverses_transaction_id) REFERENCES financial_transactions(id)`.
- `financial_transactions_fk_7 (created_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `financial_transactions_ck_1`: `length(btrim(event_key)) > 0 AND fingerprint ~ '^[0-9a-f]{64}$'`.
- `financial_transactions_ck_2`: `currency = 'THB'`.
- `financial_transactions_ck_3`: `num_nonnulls(order_id,withdrawal_id,refund_id,advertising_order_id,reconciliation_case_id) = 1`.
- `financial_transactions_ck_4`: `kind IN ('PAYMENT_CAPTURE','ORDER_RELEASE','ORDER_HOLD','WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','WITHDRAWAL_PAID','REFUND_RECOGNIZE','REFUND_PAID','AD_PURCHASE','AD_EARN','AD_REFUND','REVERSAL','RECONCILIATION')`.
- `financial_transactions_ck_5`: `(kind = 'REVERSAL') = (reverses_transaction_id IS NOT NULL)`.
- `financial_transactions_ck_6`: `reverses_transaction_id IS NULL OR reverses_transaction_id <> id`.
- `financial_transactions_ck_7`: `((kind IN ('PAYMENT_CAPTURE','ORDER_RELEASE','ORDER_HOLD') AND order_id IS NOT NULL) OR (kind IN ('WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','WITHDRAWAL_PAID') AND withdrawal_id IS NOT NULL) OR (kind IN ('REFUND_RECOGNIZE','REFUND_PAID') AND refund_id IS NOT NULL) OR (kind IN ('AD_PURCHASE','AD_EARN','AD_REFUND') AND advertising_order_id IS NOT NULL) OR (kind = 'RECONCILIATION' AND reconciliation_case_id IS NOT NULL) OR kind = 'REVERSAL')`.

**Additional indexes:**

- `financial_transactions_idx_1`: `(posted_at,id)`.
- `financial_transactions_idx_2`: `(order_id)`.
- `financial_transactions_idx_3`: `(withdrawal_id)`.
- `financial_transactions_idx_4`: `(refund_id)`.
- `financial_transactions_idx_5`: `(advertising_order_id)`.
- `financial_transactions_idx_6`: `(reconciliation_case_id)`.
- `financial_transactions_idx_7`: `(created_by_admin_id)`.

**Mutation/security policy:** Append-only committed journal, no DRAFT balance entries. Header+postings atomic. Global unique event key is permanent, independent of expiring HTTP cache. Full reversal unique; refund is its own typed economic event, not arbitrary reversal of old payout.

### 4.6 financial_postings (5 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| transaction_id | bigint | N | — | Composite PK | F |
| line_no | smallint | N | — | Composite PK; deterministic ordering | F |
| account_id | bigint | N | — | Typed business value; constraints below | F |
| side | char(1) | N | — | D / C | F |
| amount_satang | bigint | N | — | Typed business value; constraints below | F |

**PK:** `financial_postings_pk (transaction_id,line_no)`.

**UNIQUE constraints:**

None beyond PK (partial unique indexes, if any, below).

**FKs** (RESTRICT / RESTRICT):

- `financial_postings_fk_1 (transaction_id) REFERENCES financial_transactions(id)`.
- `financial_postings_fk_2 (account_id) REFERENCES financial_accounts(id)`.

**CHECKs:**

- `financial_postings_ck_1`: `line_no > 0`.
- `financial_postings_ck_2`: `side IN ('D','C')`.
- `financial_postings_ck_3`: `amount_satang > 0`.

**Additional indexes:**

- `financial_postings_idx_1`: `(account_id,transaction_id) INCLUDE (side,amount_satang)`.

**Mutation/security policy:** PK(transaction_id,line_no); immutable forever. Omit zero-value lines. Deferred balanced-journal trigger required, including header-only journals; SQL CHECK alone cannot enforce SUM.

### 4.7 merchant_payout_accounts (12 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| merchant_id | integer | N | — | Typed business value; constraints below | F |
| bank_code | varchar(20) | N | — | Typed business value; constraints below | F |
| masked_account | varchar(40) | N | — | Only masked last 4 | M |
| account_secret_ref | varchar(512) | N | — | Versioned encrypted bank number + legal holder name external reference | S |
| status | varchar(24) | N | 'PENDING_VERIFICATION' | Typed business value; constraints below | F |
| is_current | boolean | N | false | Typed business value; constraints below | F |
| requested_by_staff_id | integer | N | — | Typed business value; constraints below | F |
| verified_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| verified_at | timestamptz | Y | NULL | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| activated_at | timestamptz | Y | NULL | DB-assigned time | F |

**PK:** `merchant_payout_accounts_pk (id)`.

**UNIQUE constraints:**

- `merchant_payout_accounts_uq_1 (id,merchant_id)`.

**FKs** (RESTRICT / RESTRICT):

- `merchant_payout_accounts_fk_1 (merchant_id) REFERENCES merchants(id)`.
- `merchant_payout_accounts_fk_2 (requested_by_staff_id,merchant_id) REFERENCES merchant_staffs(id,merchant_id)`.
- `merchant_payout_accounts_fk_3 (verified_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `merchant_payout_accounts_ck_1`: `length(btrim(bank_code)) > 0 AND length(btrim(masked_account)) > 0 AND length(btrim(account_secret_ref)) > 0`.
- `merchant_payout_accounts_ck_2`: `status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','RETIRED')`.
- `merchant_payout_accounts_ck_3`: `NOT is_current OR (status = 'VERIFIED' AND activated_at IS NOT NULL)`.
- `merchant_payout_accounts_ck_4`: `(verified_at IS NULL) = (verified_by_admin_id IS NULL)`.
- `merchant_payout_accounts_ck_5`: `status NOT IN ('VERIFIED','RETIRED') OR verified_at IS NOT NULL`.
- `merchant_payout_accounts_ck_6`: `activated_at IS NULL OR verified_at IS NOT NULL`.

**Additional indexes:**

- `merchant_payout_accounts_idx_1`: UNIQUE `(merchant_id) WHERE is_current`.
- `merchant_payout_accounts_idx_2`: `(merchant_id)`.
- `merchant_payout_accounts_idx_3`: `(requested_by_staff_id,merchant_id)`.
- `merchant_payout_accounts_idx_4`: `(verified_by_admin_id)`.

**Mutation/security policy:** Never edit merchant/bank/mask/secret ref/request actor/created time. Verification/current/status timestamps follow guarded lifecycle only. Destination change = new row. Every accepted change request and activation advances merchant hold clock; rejected change never shortens existing hold.

### 4.8 merchant_withdrawals (22 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| merchant_id | integer | N | — | Typed business value; constraints below | F |
| payout_account_id | uuid | N | — | Typed business value; constraints below | F |
| policy_version_id | bigint | N | — | Typed business value; constraints below | F |
| requested_by_staff_id | integer | N | — | Typed business value; constraints below | F |
| idempotency_key | varchar(128) | N | — | Typed business value; constraints below | F |
| request_fingerprint | char(64) | N | — | Typed business value; constraints below | F |
| amount_satang | bigint | N | — | Typed business value; constraints below | F |
| fee_satang | bigint | N | 0 | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| status | varchar(24) | N | 'REQUESTED' | Typed business value; constraints below | F |
| account_review_required | boolean | N | false | Typed business value; constraints below | F |
| account_change_seen_at | timestamptz | Y | NULL | DB-assigned time | F |
| account_reviewed_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| account_reviewed_at | timestamptz | Y | NULL | DB-assigned time | F |
| reviewed_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| reviewed_at | timestamptz | Y | NULL | DB-assigned time | F |
| paid_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| paid_at | timestamptz | Y | NULL | DB-assigned time | F |
| terminal_reason_code | varchar(64) | Y | NULL | Allowlisted non-PII code | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| updated_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `merchant_withdrawals_pk (id)`.

**UNIQUE constraints:**

- `merchant_withdrawals_uq_1 (id,merchant_id)`.
- `merchant_withdrawals_uq_2 (merchant_id,idempotency_key)`.

**FKs** (RESTRICT / RESTRICT):

- `merchant_withdrawals_fk_1 (merchant_id) REFERENCES merchants(id)`.
- `merchant_withdrawals_fk_2 (payout_account_id,merchant_id) REFERENCES merchant_payout_accounts(id,merchant_id)`.
- `merchant_withdrawals_fk_3 (policy_version_id) REFERENCES finance_policy_versions(id)`.
- `merchant_withdrawals_fk_4 (requested_by_staff_id,merchant_id) REFERENCES merchant_staffs(id,merchant_id)`.
- `merchant_withdrawals_fk_5 (account_reviewed_by_admin_id) REFERENCES platform_admins(id)`.
- `merchant_withdrawals_fk_6 (reviewed_by_admin_id) REFERENCES platform_admins(id)`.
- `merchant_withdrawals_fk_7 (paid_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `merchant_withdrawals_ck_1`: `amount_satang >= 30000 AND fee_satang = 0 AND currency = 'THB'`.
- `merchant_withdrawals_ck_2`: `length(btrim(idempotency_key)) > 0 AND request_fingerprint ~ '^[0-9a-f]{64}$'`.
- `merchant_withdrawals_ck_3`: `status IN ('REQUESTED','APPROVED','PROCESSING','PAID','FAILED','REJECTED','CANCELLED')`.
- `merchant_withdrawals_ck_4`: `(status = 'PAID') = (paid_at IS NOT NULL)`.
- `merchant_withdrawals_ck_5`: `(paid_at IS NULL) = (paid_by_admin_id IS NULL)`.
- `merchant_withdrawals_ck_6`: `(reviewed_at IS NULL) = (reviewed_by_admin_id IS NULL)`.
- `merchant_withdrawals_ck_7`: `(account_reviewed_at IS NULL) = (account_reviewed_by_admin_id IS NULL)`.
- `merchant_withdrawals_ck_8`: `NOT account_review_required OR account_change_seen_at IS NOT NULL`.
- `merchant_withdrawals_ck_9`: `status NOT IN ('APPROVED','PROCESSING','PAID') OR reviewed_at IS NOT NULL`.
- `merchant_withdrawals_ck_10`: `status NOT IN ('FAILED','REJECTED','CANCELLED') OR terminal_reason_code IS NOT NULL`.

**Additional indexes:**

- `merchant_withdrawals_idx_1`: UNIQUE `(merchant_id) WHERE status IN ('REQUESTED','APPROVED','PROCESSING')`.
- `merchant_withdrawals_idx_2`: `(merchant_id,paid_at) WHERE status = 'PAID'`.
- `merchant_withdrawals_idx_3`: `(status,created_at)`.
- `merchant_withdrawals_idx_4`: `(payout_account_id,merchant_id)`.
- `merchant_withdrawals_idx_5`: `(policy_version_id)`.
- `merchant_withdrawals_idx_6`: `(requested_by_staff_id,merchant_id)`.
- `merchant_withdrawals_idx_7`: `(account_reviewed_by_admin_id)`.
- `merchant_withdrawals_idx_8`: `(reviewed_by_admin_id)`.
- `merchant_withdrawals_idx_9`: `(paid_by_admin_id)`.

**Mutation/security policy:** Immutable amount/currency/fee/destination/policy/requester/key/fingerprint. Guarded state/review fields only. PAID and other terminal states immutable. paid_at DB clock of successful confirmation, never client-supplied/backdated; bank actual time on finance_transfers.

### 4.9 finance_refunds (19 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| order_id | integer | N | — | Typed business value; constraints below | F |
| merchant_id | integer | N | — | Typed business value; constraints below | F |
| idempotency_key | varchar(128) | N | — | Typed business value; constraints below | F |
| request_fingerprint | char(64) | N | — | Typed business value; constraints below | F |
| status | varchar(24) | N | 'REQUESTED' | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| customer_refund_satang | bigint | N | — | Typed business value; constraints below | F |
| merchant_recovery_satang | bigint | N | — | Typed business value; constraints below | F |
| commission_reversal_satang | bigint | N | — | Typed business value; constraints below | F |
| subsidy_reversal_satang | bigint | N | — | Typed business value; constraints below | F |
| destination_secret_ref | varchar(512) | N | — | Verified immutable refund account + holder; separate from merchant payout | S |
| reason_code | varchar(64) | N | — | Typed business value; constraints below | F |
| requested_by_admin_id | integer | N | — | Typed business value; constraints below | F |
| approved_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| approved_at | timestamptz | Y | NULL | DB-assigned time | F |
| paid_at | timestamptz | Y | NULL | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| updated_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `finance_refunds_pk (id)`.

**UNIQUE constraints:**

- `finance_refunds_uq_1 (id,merchant_id)`.
- `finance_refunds_uq_2 (merchant_id,idempotency_key)`.

**FKs** (RESTRICT / RESTRICT):

- `finance_refunds_fk_1 (order_id,merchant_id) REFERENCES order_financial_snapshots(order_id,merchant_id)`.
- `finance_refunds_fk_2 (requested_by_admin_id) REFERENCES platform_admins(id)`.
- `finance_refunds_fk_3 (approved_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `finance_refunds_ck_1`: `currency = 'THB' AND customer_refund_satang > 0 AND merchant_recovery_satang >= 0 AND commission_reversal_satang >= 0 AND subsidy_reversal_satang >= 0`.
- `finance_refunds_ck_2`: `customer_refund_satang = merchant_recovery_satang + commission_reversal_satang - subsidy_reversal_satang`.
- `finance_refunds_ck_3`: `status IN ('REQUESTED','APPROVED','PROCESSING','PAID','REJECTED','CANCELLED')`.
- `finance_refunds_ck_4`: `length(btrim(idempotency_key)) > 0 AND request_fingerprint ~ '^[0-9a-f]{64}$'`.
- `finance_refunds_ck_5`: `length(btrim(reason_code)) > 0 AND length(btrim(destination_secret_ref)) > 0`.
- `finance_refunds_ck_6`: `(approved_at IS NULL) = (approved_by_admin_id IS NULL)`.
- `finance_refunds_ck_7`: `(status = 'PAID') = (paid_at IS NOT NULL)`.
- `finance_refunds_ck_8`: `status NOT IN ('APPROVED','PROCESSING','PAID') OR approved_at IS NOT NULL`.

**Additional indexes:**

- `finance_refunds_idx_1`: UNIQUE `(order_id) WHERE status IN ('REQUESTED','APPROVED','PROCESSING','PAID')`.
- `finance_refunds_idx_2`: `(merchant_id,created_at)`.
- `finance_refunds_idx_3`: `(status,created_at)`.
- `finance_refunds_idx_4`: `(order_id,merchant_id)`.
- `finance_refunds_idx_5`: `(requested_by_admin_id)`.
- `finance_refunds_idx_6`: `(approved_by_admin_id)`.

**Mutation/security policy:** Full refund only in initial technical proposal; partial refunds remain gated. Basis/destination/requester immutable. Guard checks exact original snapshot and prevents cumulative over-refund. APPROVED recognises refund liability exactly once; no cancellation after recognition without reviewed compensating event.

### 4.10 finance_transfers (19 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| merchant_id | integer | N | — | Typed business value; constraints below | F |
| withdrawal_id | uuid | Y | NULL | Typed business value; constraints below | F |
| refund_id | uuid | Y | NULL | Typed business value; constraints below | F |
| execution_key | uuid | N | — | Stable server operation key before any bank action | F |
| provider | varchar(40) | N | — | Bank/rail reference namespace | F |
| source_account_key | varchar(120) | N | — | Opaque stable canonical platform debit-account identity across credential rotations; not bank number | S |
| status | varchar(16) | N | 'STARTED' | Typed business value; constraints below | F |
| amount_satang | bigint | N | — | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| external_reference | varchar(160) | Y | NULL | Canonical bank movement reference | S |
| bank_executed_at | timestamptz | Y | NULL | DB-assigned time | F |
| evidence_object_key | varchar(512) | Y | NULL | Private proof; no signed URL/full provider response | S |
| failure_code | varchar(64) | Y | NULL | Typed business value; constraints below | F |
| initiated_by_admin_id | integer | N | — | Typed business value; constraints below | F |
| confirmed_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| confirmed_at | timestamptz | Y | NULL | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| updated_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `finance_transfers_pk (id)`.

**UNIQUE constraints:**

- `finance_transfers_uq_1 (execution_key)`.

**FKs** (RESTRICT / RESTRICT):

- `finance_transfers_fk_1 (merchant_id) REFERENCES merchants(id)`.
- `finance_transfers_fk_2 (withdrawal_id,merchant_id) REFERENCES merchant_withdrawals(id,merchant_id)`.
- `finance_transfers_fk_3 (refund_id,merchant_id) REFERENCES finance_refunds(id,merchant_id)`.
- `finance_transfers_fk_4 (initiated_by_admin_id) REFERENCES platform_admins(id)`.
- `finance_transfers_fk_5 (confirmed_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `finance_transfers_ck_1`: `num_nonnulls(withdrawal_id,refund_id) = 1`.
- `finance_transfers_ck_2`: `amount_satang > 0 AND currency = 'THB'`.
- `finance_transfers_ck_3`: `length(btrim(provider)) > 0 AND length(btrim(source_account_key)) > 0`.
- `finance_transfers_ck_4`: `status IN ('STARTED','UNKNOWN','CONFIRMED','FAILED')`.
- `finance_transfers_ck_5`: `external_reference IS NULL OR length(btrim(external_reference)) > 0`.
- `finance_transfers_ck_6`: `(status = 'CONFIRMED') = (confirmed_at IS NOT NULL)`.
- `finance_transfers_ck_7`: `(confirmed_at IS NULL) = (confirmed_by_admin_id IS NULL)`.
- `finance_transfers_ck_8`: `status <> 'CONFIRMED' OR (external_reference IS NOT NULL AND bank_executed_at IS NOT NULL AND evidence_object_key IS NOT NULL)`.
- `finance_transfers_ck_9`: `status <> 'FAILED' OR failure_code IS NOT NULL`.

**Additional indexes:**

- `finance_transfers_idx_1`: UNIQUE `(provider,source_account_key,external_reference) WHERE external_reference IS NOT NULL`.
- `finance_transfers_idx_2`: UNIQUE `(withdrawal_id) WHERE withdrawal_id IS NOT NULL AND status IN ('STARTED','UNKNOWN','CONFIRMED')`.
- `finance_transfers_idx_3`: UNIQUE `(refund_id) WHERE refund_id IS NOT NULL AND status IN ('STARTED','UNKNOWN','CONFIRMED')`.
- `finance_transfers_idx_4`: `(status,created_at)`.
- `finance_transfers_idx_5`: `(merchant_id)`.
- `finance_transfers_idx_6`: `(withdrawal_id,merchant_id)`.
- `finance_transfers_idx_7`: `(refund_id,merchant_id)`.
- `finance_transfers_idx_8`: `(initiated_by_admin_id)`.
- `finance_transfers_idx_9`: `(confirmed_by_admin_id)`.

**Mutation/security policy:** Each row one manual transfer attempt, not automated payout execution. Amount/source/target/key immutable; guarded result fields only. CONFIRMED/FAILED terminal; UNKNOWN blocks another attempt and fund release. Unique bank reference shared across both payout and refund. Canonical source_account_key must remain identical across secret rotations for the same physical account; provider/account namespace comes from trusted configuration, not request input.

### 4.11 advertising_orders (19 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| merchant_id | integer | N | — | Typed business value; constraints below | F |
| banner_id | integer | N | — | Typed business value; constraints below | F |
| policy_version_id | bigint | N | — | Typed business value; constraints below | F |
| requested_by_staff_id | integer | N | — | Typed business value; constraints below | F |
| idempotency_key | varchar(128) | N | — | Typed business value; constraints below | F |
| request_fingerprint | char(64) | N | — | Typed business value; constraints below | F |
| fee_satang | bigint | N | 30000 | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| duration_days | integer | N | 30 | Typed business value; constraints below | F |
| consented_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| consent_version | varchar(40) | N | — | Exact displayed fee/service terms identifier | F |
| status | varchar(24) | N | 'PAID_PENDING_REVIEW' | Typed business value; constraints below | F |
| reviewed_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| reviewed_at | timestamptz | Y | NULL | DB-assigned time | F |
| starts_at | timestamptz | Y | NULL | DB-assigned time | F |
| ends_at | timestamptz | Y | NULL | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |
| updated_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `advertising_orders_pk (id)`.

**UNIQUE constraints:**

- `advertising_orders_uq_1 (merchant_id,idempotency_key)`.

**FKs** (RESTRICT / RESTRICT):

- `advertising_orders_fk_1 (merchant_id) REFERENCES merchants(id)`.
- `advertising_orders_fk_2 (banner_id,merchant_id) REFERENCES banners(id,merchant_id)`.
- `advertising_orders_fk_3 (policy_version_id) REFERENCES finance_policy_versions(id)`.
- `advertising_orders_fk_4 (requested_by_staff_id,merchant_id) REFERENCES merchant_staffs(id,merchant_id)`.
- `advertising_orders_fk_5 (reviewed_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `advertising_orders_ck_1`: `fee_satang = 30000 AND currency = 'THB' AND duration_days = 30`.
- `advertising_orders_ck_2`: `length(btrim(idempotency_key)) > 0 AND request_fingerprint ~ '^[0-9a-f]{64}$' AND length(btrim(consent_version)) > 0`.
- `advertising_orders_ck_3`: `status IN ('PAID_PENDING_REVIEW','SCHEDULED','ACTIVE','EXPIRED','REJECTED_REFUNDED','CANCELLED_REFUNDED')`.
- `advertising_orders_ck_4`: `(reviewed_at IS NULL) = (reviewed_by_admin_id IS NULL)`.
- `advertising_orders_ck_5`: `(starts_at IS NULL) = (ends_at IS NULL)`.
- `advertising_orders_ck_6`: `ends_at IS NULL OR extract(epoch FROM (ends_at - starts_at)) = 2592000`.
- `advertising_orders_ck_7`: `status NOT IN ('SCHEDULED','ACTIVE','EXPIRED') OR (starts_at IS NOT NULL AND reviewed_at IS NOT NULL)`.

**Additional indexes:**

- `advertising_orders_idx_1`: UNIQUE `(banner_id) WHERE status IN ('PAID_PENDING_REVIEW','SCHEDULED','ACTIVE')`.
- `advertising_orders_idx_2`: `(status,starts_at,ends_at)`.
- `advertising_orders_idx_3`: `(banner_id,merchant_id)`.
- `advertising_orders_idx_4`: `(policy_version_id)`.
- `advertising_orders_idx_5`: `(requested_by_staff_id,merchant_id)`.
- `advertising_orders_idx_6`: `(reviewed_by_admin_id)`.

**Mutation/security policy:** Insert+AVAILABLE debit atomic after explicit MANAGER consent. No balance => no purchase row committed. Fee/terms/consent/banner/merchant immutable. Schedule fixed on approval; repeat purchase for renewal. Creative remains existing banner and Admin moderation. Partial cancellation/refund not enabled until remaining policy approved.

### 4.12 finance_reconciliation_cases (16 columns)

| Column | PostgreSQL type | Null | Default | Meaning | Class |
|---|---|---|---|---|---|
| id | uuid | N | — | PK; server crypto.randomUUID() | F |
| case_key | varchar(180) | N | — | Typed business value; constraints below | F |
| kind | varchar(32) | N | — | Typed business value; constraints below | F |
| merchant_id | integer | Y | NULL | Typed business value; constraints below | F |
| order_id | integer | Y | NULL | Typed business value; constraints below | F |
| transfer_id | uuid | Y | NULL | Typed business value; constraints below | F |
| business_date | date | N | — | Typed business value; constraints below | F |
| currency | char(3) | N | 'THB' | Typed business value; constraints below | F |
| expected_satang | bigint | Y | NULL | Signed expected balance; NULL nonamount discrepancy | F |
| observed_satang | bigint | Y | NULL | Typed business value; constraints below | F |
| evidence_object_key | varchar(512) | Y | NULL | Private immutable reconciliation export/version | S |
| status | varchar(16) | N | 'OPEN' | Typed business value; constraints below | F |
| resolution_code | varchar(64) | Y | NULL | Typed business value; constraints below | F |
| resolved_by_admin_id | integer | Y | NULL | Typed business value; constraints below | F |
| resolved_at | timestamptz | Y | NULL | DB-assigned time | F |
| created_at | timestamptz | N | clock_timestamp() | DB-assigned time | F |

**PK:** `finance_reconciliation_cases_pk (id)`.

**UNIQUE constraints:**

- `finance_reconciliation_cases_uq_1 (case_key)`.

**FKs** (RESTRICT / RESTRICT):

- `finance_reconciliation_cases_fk_1 (merchant_id) REFERENCES merchants(id)`.
- `finance_reconciliation_cases_fk_2 (order_id) REFERENCES orders(id)`.
- `finance_reconciliation_cases_fk_3 (transfer_id) REFERENCES finance_transfers(id)`.
- `finance_reconciliation_cases_fk_4 (resolved_by_admin_id) REFERENCES platform_admins(id)`.

**CHECKs:**

- `finance_reconciliation_cases_ck_1`: `length(btrim(case_key)) > 0 AND currency = 'THB'`.
- `finance_reconciliation_cases_ck_2`: `kind IN ('STATEMENT_MATCH','BANK_MISMATCH','LEDGER_MISMATCH','UNKNOWN_TRANSFER','RECIPIENT_MISMATCH','LEGACY_UNKNOWN','CONTROL_EXCEPTION')`.
- `finance_reconciliation_cases_ck_3`: `status IN ('OPEN','RESOLVED')`.
- `finance_reconciliation_cases_ck_4`: `(status = 'RESOLVED') = (resolved_at IS NOT NULL)`.
- `finance_reconciliation_cases_ck_5`: `(resolved_at IS NULL) = (resolved_by_admin_id IS NULL)`.
- `finance_reconciliation_cases_ck_6`: `status <> 'RESOLVED' OR resolution_code IS NOT NULL`.
- `finance_reconciliation_cases_ck_7`: `(expected_satang IS NULL) = (observed_satang IS NULL)`.

**Additional indexes:**

- `finance_reconciliation_cases_idx_1`: `(status,business_date)`.
- `finance_reconciliation_cases_idx_2`: `(merchant_id)`.
- `finance_reconciliation_cases_idx_3`: `(order_id)`.
- `finance_reconciliation_cases_idx_4`: `(transfer_id)`.
- `finance_reconciliation_cases_idx_5`: `(resolved_by_admin_id)`.

**Mutation/security policy:** Immutable observed facts/evidence; resolution fields guarded and audit-logged. Correction posts new linked transaction, never edits original journal. Store exceptions and evidence-backed STATEMENT_MATCH cases here; a statement match authorizes a CASH_CLEARING→BANK asset reclassification, with exact matched source totals and uniqueness enforced in the posting function. Successful daily-run summary remains in audit_logs with private report key, not another report-run table.

## 5. Mandatory database guards (cross-row invariants)

These are proposed named triggers/procedures, **not implemented PL/pgSQL**. An ordinary CHECK cannot run a ledger SUM.
All financial mutation endpoints must use a small constrained posting/state API in one PostgreSQL transaction.
Application DB role gets SELECT plus EXECUTE on those functions, not arbitrary journal INSERT/UPDATE/DELETE.
The posting function accepts a typed source/event intent, never an existing transaction_id or arbitrary account/line array. It creates a NEW header and all lines together. On an existing event_key it checks fingerprint and returns the original result without inserting lines. No exposed function can append lines to a committed header; balancing alone would otherwise permit a balanced but fraudulent late append.
SECURITY DEFINER functions use fixed search_path, no dynamic SQL, validated tenant/actor, least-privileged owner.
An admin application role is not a database superuser. Migration/backup role is separate.

| Proposed guard | Timing / affected tables | Exact invariant |
|---|---|---|
| finance_immutable_guard | BEFORE UPDATE/DELETE on policy, recipient, snapshot, accounts, transactions, postings | Reject UPDATE/DELETE entirely on these six immutable entities; account creation allowed. Business request tables protect immutable column groups specified above and forbid DELETE |
| finance_journal_balanced | CONSTRAINT TRIGGER AFTER INSERT on transactions AND postings, DEFERRABLE INITIALLY DEFERRED | For each affected tx: >=2 postings; SUM(amount FILTER side D) = SUM(amount FILTER side C), using PostgreSQL numeric SUM(bigint); account currency = tx currency; reject header-only journal at commit |
| finance_posting_context_guard | Posting function plus deferred INSERT guard on transactions/postings | Resolve merchant from sole source FK (snapshot/withdrawal/refund/ad/case). Every merchant-scoped account on that journal must belong to that merchant. No cross-merchant transfer journal. Account kinds and exact sums must match event templates in Design; a balanced but wrongly classified journal is rejected |
| finance_reconciliation_source_guard | Guarded case creation/resolution and posting function | If a case links order/transfer and merchant, all nonnull references resolve the same merchant. STATEMENT_MATCH uses one original payment per case, case_key statement-match:{paymentId}; verify statement evidence and reclassify only that original captured Q once. Reuse case on retry, never invent new case ids to rematch the same receipt. Exact corrective REVERSAL cannot erase a confirmed payout/refund or count as a new bank transfer |
| finance_balances_guard | Deferred guard after postings, backed by pre-write merchant row lock | SUM(C-D) for each merchant PENDING/AVAILABLE/RESERVED/HELD >=0; SUM(D-C) for DEBT >=0; spending/release offset outstanding debt before creating spendable availability. Balancing alone is insufficient. All writers acquire merchant lock before calculating sums |
| finance_route_guard | BEFORE INSERT/UPDATE orders/payments | New PLATFORM order must pin existing recipient; no route mutation after insertion. Payment version must equal parent using IS NOT DISTINCT FROM, including no NULL bypass. Existing LEGACY_DIRECT update of unrelated status remains valid |
| finance_paid_snapshot_guard | Deferred INSERT snapshot / payment state transition | Exactly one snapshot and PAYMENT_CAPTURE for first successful PLATFORM PAID, in same transaction; paid_payment belongs order, paid amount/reference/recipient verified, snapshot component sums equal frozen order. Legacy PAID does not require finance. Captured amounts/ref/reference/order/recipient/paid_at cannot later mutate; approved refund status may change without altering original facts |
| finance_order_source_guard | BEFORE UPDATE existing PLATFORM orders | Merchant, customer, amount fields, discount JSON/funding and route immutable once order pricing is accepted. Original status/rider lifecycle remains available; no rewriting an order total to recover finance |
| finance_completion_guard | Existing COMPLETED transaction + deferred journal guard | Platform COMPLETED creates ORDER_RELEASE once; move original entitlement out of PENDING; offset merchant debt before AVAILABLE. Paid cancellation/rejection moves residual entitlement into HELD once pending full-refund decision; no automatic payment-status rewrite |
| finance_withdrawal_guard | BEFORE business-row UPDATE; deferred finance source/journal consistency | Legal lifecycle only; exactly one reserve for committed request, exactly one release on proven failure/reject/cancel, exactly one payment on PAID; PAID has matching CONFIRMED transfer amount/account and authorized SUPER_ADMIN actor. Paid_at DB clock, immutable |
| finance_account_change_guard | Payout-account request/activation under merchant lock | Advance merchant timestamp monotonically; all nonterminal withdrawals flagged account_review_required=true, account_change_seen_at=new timestamp, account review fields cleared. Never change their destination FK. Clear flag only after permissioned review of latest timestamp, captured in audit_logs |
| finance_transfer_guard | Transfer transition under merchant + source lock | Source amount/currency/tenant match; destination obtained from immutable withdrawal/refund source. STARTED→UNKNOWN/CONFIRMED/FAILED; UNKNOWN→CONFIRMED/FAILED. No terminal mutation. FAILED requires proof no bank transfer; timeout is UNKNOWN. One unresolved or confirmed transfer/source enforced by partial UQ |
| finance_refund_guard | Approval/paid transition under merchant + order + refund locks | Full-refund components match original snapshot under approved refund policy, one active/successful refund/order; approved refund journal immutable; confirmed transfer settles same liability exactly once. Recognized refund cannot be silently cancelled/deleted |
| finance_ad_guard | Purchase/approval/service posting under merchant + ad + banner locks | MANAGER consent, exact 30000 reserve-free AVAILABLE debit once, matched AD_DEFERRED credit; no purchase committed if insufficient spendable balance. Banner tenant/scope MERCHANT and schedule equal purchase, valid approved creative, no publication without funding/review. Prevent merchant changing billed schedule or retargeting ownership |
| finance_mutable_clock_guard | BEFORE allowed request/transfer/refund/ad UPDATE | Set updated_at from DB; never accept client timestamps for eligibility/payment evidence confirmation |
| finance_outbox_guard | Finance producer in same posting transaction | financial_transaction_id source exists; existing unique dedupe_key includes event+source+recipient; private account/evidence refs absent from payload |

All deferred guards must check final transaction state (not prematurely reject intermediate inserts).
Account initial creation and first journal use merchant row lock, then unique accounts keys; handle conflict by selecting same account.
If a future cache is added it must be rebuildable from postings and reconciled per account; **this proposal has no balance cache**.

## 6. Source uniqueness / retention

| Economic event | Permanent event_key pattern | Matching source rule |
|---|---|---|
| Original capture | payment:{paymentId}:capture | Snapshot UNIQUE paid_payment_id + order PK; only originally PAID platform payment |
| Completion | order:{orderId}:release | At most once, even concurrent completion/retry |
| Paid cancellation/rejection hold | order:{orderId}:hold | Remaining original entitlement only; no negative PENDING |
| Withdrawal | withdrawal:{uuid}:reserve / release / paid | Disjoint valid terminal alternatives; DB state guard prevents release plus paid |
| Full refund | refund:{uuid}:recognize / paid | Permanent recognized liability and single outbound settlement |
| Banner charge | ad:{uuid}:purchase | One consent/request; explicit renewed purchase has new uuid |
| Pre-service ad refund | ad:{uuid}:refund | AD_REFUND debits unearned AD_DEFERRED30000 and credits merchant debt/held/available as applicable, once; not a generic exact-inverse REVERSAL |
| Banner earned slice | ad:{uuid}:earn:{0..29} | Each allowed earned daily slice once, never future slice (policy pending) |
| Full corrective reversal | reverse:{transactionId} | reverses_transaction_id UNIQUE and exact inverse postings; business authorization still required |
| Reconciliation correction | reconciliation:{caseId}:{approvedCorrectionId} | Immutable evidence/actor + fixed posting fingerprint |

Same key+same fingerprint returns original result; same key+different fingerprint conflicts.
Request UUID and canonical fingerprint are server-normalized and scoped by merchant on withdrawals/refunds/ads.
Existing idempotency_keys may cache HTTP response but expiration never unlocks an economic source.
Journal/request/source keys and bank references are retained with finance history, never purged on short HTTP TTL.
Audit redaction must redact secret refs, private evidence keys and external refs from generic request logs.
Case reports contain allowlisted totals/identifiers only; raw bank statement stored privately.

## 7. Remaining review boundary

All 25 Owner decisions in Design are definitive. Schema itself remains proposed.
Two extra policies were NOT part of those 25 decisions:
1. Full-refund treatment of previously earned commission/delivery/subsidy (examples assume full reversal), and any later partial refunds.
2. Advertising earned-revenue timing and cancellation/proration (examples assume 30 equal daily slices after activation).

Full-refund and advertising recognition/mid-service cancellation stay gated until these policies are approved.
No fallback that changes locked funding, fee, cooldown or debt rules.
Managed secret/evidence storage, exact bank-reference namespace and verified recipient/account identity are operational enablement prerequisites, not a request to reopen Owner decisions.

