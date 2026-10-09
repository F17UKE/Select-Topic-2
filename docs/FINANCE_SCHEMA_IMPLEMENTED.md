# Finance 008 — implemented PostgreSQL catalog

Generated read-only from the local catalog after 202610090008_marketplace_finance.cjs. Schema definitions only; no row data, secrets or financial balances. The additive migration is the executable authority. No previous migration was edited.

## finance_policy_versions

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | bigint | NO | IDENTITY |
| version | character varying(40) | NO | — |
| commission_bps | integer | NO | 500 |
| calculation_version | character varying(40) | NO | 'FINANCE_V1'::character varying |
| minimum_withdrawal_satang | bigint | NO | 30000 |
| maximum_withdrawal_satang | bigint | YES | — |
| withdrawal_fee_satang | bigint | NO | 0 |
| approved_by_admin_id | integer | NO | — |
| created_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `finance_policy_versions_approved_by_admin_id_fkey`: `FOREIGN KEY (approved_by_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT`
- `finance_policy_versions_calculation_version_check`: `CHECK (((calculation_version)::text = 'FINANCE_V1'::text))`
- `finance_policy_versions_commission_bps_check`: `CHECK ((commission_bps = 500))`
- `finance_policy_versions_maximum_withdrawal_satang_check`: `CHECK ((maximum_withdrawal_satang IS NULL))`
- `finance_policy_versions_minimum_withdrawal_satang_check`: `CHECK ((minimum_withdrawal_satang = 30000))`
- `finance_policy_versions_pkey`: `PRIMARY KEY (id)`
- `finance_policy_versions_version_key`: `UNIQUE (version)`
- `finance_policy_versions_withdrawal_fee_satang_check`: `CHECK ((withdrawal_fee_satang = 0))`

Indexes:

- `CREATE UNIQUE INDEX finance_policy_versions_pkey ON public.finance_policy_versions USING btree (id)`
- `CREATE UNIQUE INDEX finance_policy_versions_version_key ON public.finance_policy_versions USING btree (version)`

Triggers:

- `CREATE TRIGGER finance_immutable BEFORE DELETE OR UPDATE ON public.finance_policy_versions FOR EACH ROW EXECUTE FUNCTION finance_immutable()`

## platform_payment_recipients

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| version | character varying(80) | NO | — |
| identity_type | character varying(24) | NO | — |
| display_name | character varying(120) | NO | — |
| masked_identity | character varying(40) | NO | — |
| encrypted_identity | text | NO | — |
| source_account_key | character(64) | NO | — |
| created_by_admin_id | integer | NO | — |
| created_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `platform_payment_recipients_created_by_admin_id_fkey`: `FOREIGN KEY (created_by_admin_id) REFERENCES platform_admins(id) ON DELETE RESTRICT`
- `platform_payment_recipients_encrypted_identity_check`: `CHECK ((encrypted_identity ~~ 'v1.%'::text))`
- `platform_payment_recipients_identity_type_check`: `CHECK (((identity_type)::text = ANY ((ARRAY['PHONE'::character varying, 'NATIONAL_ID'::character varying, 'TAX_ID'::character varying, 'EWALLET'::character varying])::text[])))`
- `platform_payment_recipients_pkey`: `PRIMARY KEY (id)`
- `platform_payment_recipients_version_key`: `UNIQUE (version)`

Indexes:

- `CREATE UNIQUE INDEX platform_payment_recipients_pkey ON public.platform_payment_recipients USING btree (id)`
- `CREATE UNIQUE INDEX platform_payment_recipients_version_key ON public.platform_payment_recipients USING btree (version)`

Triggers:

- `CREATE TRIGGER finance_immutable BEFORE DELETE OR UPDATE ON public.platform_payment_recipients FOR EACH ROW EXECUTE FUNCTION finance_immutable()`

## order_financial_snapshots

| Column | Type | Null | Default/identity |
|---|---|---|---|
| order_id | integer | NO | — |
| merchant_id | integer | NO | — |
| paid_payment_id | integer | NO | — |
| recipient_version_id | uuid | NO | — |
| policy_version_id | bigint | NO | — |
| commission_bps | integer | NO | 500 |
| calculation_version | character varying(40) | NO | 'FINANCE_V1'::character varying |
| food_subtotal_satang | bigint | NO | — |
| delivery_fee_satang | bigint | NO | — |
| merchant_food_discount_satang | bigint | NO | — |
| merchant_delivery_discount_satang | bigint | NO | — |
| platform_food_discount_satang | bigint | NO | — |
| platform_delivery_discount_satang | bigint | NO | — |
| commission_base_satang | bigint | NO | — |
| commission_satang | bigint | NO | — |
| platform_subsidy_satang | bigint | NO | — |
| merchant_entitlement_satang | bigint | NO | — |
| customer_paid_satang | bigint | NO | — |
| paid_at | timestamp with time zone | NO | — |

Constraints:

- `order_financial_snapshots_calculation_version_check`: `CHECK (((calculation_version)::text = 'FINANCE_V1'::text))`
- `order_financial_snapshots_check`: `CHECK (((merchant_food_discount_satang + platform_food_discount_satang) <= food_subtotal_satang))`
- `order_financial_snapshots_check1`: `CHECK (((merchant_delivery_discount_satang + platform_delivery_discount_satang) <= delivery_fee_satang))`
- `order_financial_snapshots_check2`: `CHECK ((commission_base_satang = (food_subtotal_satang - merchant_food_discount_satang)))`
- `order_financial_snapshots_check3`: `CHECK (((commission_satang)::numeric = floor(((((commission_base_satang)::numeric * (500)::numeric) + (5000)::numeric) / (10000)::numeric))))`
- `order_financial_snapshots_check4`: `CHECK ((platform_subsidy_satang = (platform_food_discount_satang + platform_delivery_discount_satang)))`
- `order_financial_snapshots_check5`: `CHECK ((merchant_entitlement_satang = (((commission_base_satang + delivery_fee_satang) - merchant_delivery_discount_satang) - commission_satang)))`
- `order_financial_snapshots_check6`: `CHECK ((customer_paid_satang = ((merchant_entitlement_satang + commission_satang) - platform_subsidy_satang)))`
- `order_financial_snapshots_commission_base_satang_check`: `CHECK ((commission_base_satang >= 0))`
- `order_financial_snapshots_commission_bps_check`: `CHECK ((commission_bps = 500))`
- `order_financial_snapshots_commission_satang_check`: `CHECK ((commission_satang >= 0))`
- `order_financial_snapshots_customer_paid_satang_check`: `CHECK ((customer_paid_satang > 0))`
- `order_financial_snapshots_delivery_fee_satang_check`: `CHECK ((delivery_fee_satang >= 0))`
- `order_financial_snapshots_food_subtotal_satang_check`: `CHECK ((food_subtotal_satang >= 0))`
- `order_financial_snapshots_merchant_delivery_discount_sata_check`: `CHECK ((merchant_delivery_discount_satang >= 0))`
- `order_financial_snapshots_merchant_entitlement_satang_check`: `CHECK ((merchant_entitlement_satang >= 0))`
- `order_financial_snapshots_merchant_food_discount_satang_check`: `CHECK ((merchant_food_discount_satang >= 0))`
- `order_financial_snapshots_order_id_merchant_id_fkey`: `FOREIGN KEY (order_id, merchant_id) REFERENCES orders(id, merchant_id) ON DELETE RESTRICT`
- `order_financial_snapshots_order_id_merchant_id_key`: `UNIQUE (order_id, merchant_id)`
- `order_financial_snapshots_order_id_recipient_version_id_fkey`: `FOREIGN KEY (order_id, recipient_version_id) REFERENCES orders(id, payment_recipient_version_id) ON DELETE RESTRICT`
- `order_financial_snapshots_paid_payment_id_key`: `UNIQUE (paid_payment_id)`
- `order_financial_snapshots_paid_payment_id_order_id_fkey`: `FOREIGN KEY (paid_payment_id, order_id) REFERENCES payments(id, order_id) ON DELETE RESTRICT`
- `order_financial_snapshots_pkey`: `PRIMARY KEY (order_id)`
- `order_financial_snapshots_platform_delivery_discount_sata_check`: `CHECK ((platform_delivery_discount_satang >= 0))`
- `order_financial_snapshots_platform_food_discount_satang_check`: `CHECK ((platform_food_discount_satang >= 0))`
- `order_financial_snapshots_platform_subsidy_satang_check`: `CHECK ((platform_subsidy_satang >= 0))`
- `order_financial_snapshots_policy_version_id_fkey`: `FOREIGN KEY (policy_version_id) REFERENCES finance_policy_versions(id)`

Indexes:

- `CREATE UNIQUE INDEX order_financial_snapshots_pkey ON public.order_financial_snapshots USING btree (order_id)`
- `CREATE UNIQUE INDEX order_financial_snapshots_paid_payment_id_key ON public.order_financial_snapshots USING btree (paid_payment_id)`
- `CREATE UNIQUE INDEX order_financial_snapshots_order_id_merchant_id_key ON public.order_financial_snapshots USING btree (order_id, merchant_id)`
- `CREATE INDEX finance_snapshot_merchant_idx ON public.order_financial_snapshots USING btree (merchant_id, paid_at)`

Triggers:

- `CREATE TRIGGER finance_snapshot_guard BEFORE INSERT ON public.order_financial_snapshots FOR EACH ROW EXECUTE FUNCTION finance_snapshot_guard()`
- `CREATE TRIGGER finance_immutable BEFORE DELETE OR UPDATE ON public.order_financial_snapshots FOR EACH ROW EXECUTE FUNCTION finance_immutable()`

## financial_accounts

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | bigint | NO | IDENTITY |
| merchant_id | integer | YES | — |
| kind | character varying(32) | NO | — |

Constraints:

- `financial_accounts_check`: `CHECK ((((merchant_id IS NOT NULL) AND ((kind)::text = ANY ((ARRAY['MERCHANT_PENDING'::character varying, 'MERCHANT_AVAILABLE'::character varying, 'MERCHANT_RESERVED'::character varying, 'MERCHANT_HELD'::character varying, 'MERCHANT_DEBT'::character varying])::text[]))) OR ((merchant_id IS NULL) AND ((kind)::text = ANY ((ARRAY['CASH_CLEARING'::character varying, 'BANK'::character varying, 'COMMISSION_DEFERRED'::character varying, 'COMMISSION_REVENUE'::character varying, 'SUBSIDY_EXPENSE'::character varying, 'REFUND_PAYABLE'::character varying, 'AD_DEFERRED'::character varying, 'AD_REVENUE'::character varying])::text[])))))`
- `financial_accounts_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT`
- `financial_accounts_merchant_id_kind_key`: `UNIQUE NULLS NOT DISTINCT (merchant_id, kind)`
- `financial_accounts_pkey`: `PRIMARY KEY (id)`

Indexes:

- `CREATE UNIQUE INDEX financial_accounts_pkey ON public.financial_accounts USING btree (id)`
- `CREATE UNIQUE INDEX financial_accounts_merchant_id_kind_key ON public.financial_accounts USING btree (merchant_id, kind) NULLS NOT DISTINCT`

Triggers:

- `CREATE TRIGGER finance_immutable BEFORE DELETE OR UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION finance_immutable()`

## financial_transactions

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | bigint | NO | IDENTITY |
| merchant_id | integer | NO | — |
| event_key | character varying(180) | NO | — |
| fingerprint | character(64) | NO | — |
| kind | character varying(40) | NO | — |
| order_id | integer | YES | — |
| withdrawal_id | uuid | YES | — |
| refund_id | uuid | YES | — |
| advertising_order_id | uuid | YES | — |
| creating_xid | bigint | NO | txid_current() |
| posted_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `finance_balanced_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `financial_transactions_advertising_order_id_fkey`: `FOREIGN KEY (advertising_order_id) REFERENCES advertising_orders(id)`
- `financial_transactions_check`: `CHECK ((num_nonnulls(order_id, withdrawal_id, refund_id, advertising_order_id) = 1))`
- `financial_transactions_event_key_check`: `CHECK ((length(btrim((event_key)::text)) > 0))`
- `financial_transactions_event_key_key`: `UNIQUE (event_key)`
- `financial_transactions_kind_check`: `CHECK (((kind)::text = ANY ((ARRAY['ORDER_PAID'::character varying, 'ORDER_COMPLETED'::character varying, 'ORDER_HELD'::character varying, 'WITHDRAWAL_RESERVE'::character varying, 'WITHDRAWAL_RELEASE'::character varying, 'WITHDRAWAL_PAID'::character varying, 'REFUND_RECOGNIZE'::character varying, 'REFUND_PAID'::character varying, 'AD_PURCHASE'::character varying, 'AD_EARN'::character varying, 'AD_REFUND'::character varying])::text[])))`
- `financial_transactions_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `financial_transactions_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES order_financial_snapshots(order_id)`
- `financial_transactions_pkey`: `PRIMARY KEY (id)`
- `financial_transactions_refund_id_fkey`: `FOREIGN KEY (refund_id) REFERENCES finance_refunds(id)`
- `financial_transactions_withdrawal_id_fkey`: `FOREIGN KEY (withdrawal_id) REFERENCES merchant_withdrawals(id)`

Indexes:

- `CREATE UNIQUE INDEX financial_transactions_pkey ON public.financial_transactions USING btree (id)`
- `CREATE UNIQUE INDEX financial_transactions_event_key_key ON public.financial_transactions USING btree (event_key)`
- `CREATE INDEX finance_journal_merchant_idx ON public.financial_transactions USING btree (merchant_id, posted_at, id)`

Triggers:

- `CREATE CONSTRAINT TRIGGER finance_balanced_guard AFTER INSERT ON public.financial_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_balanced_guard()`
- `CREATE TRIGGER finance_source_guard BEFORE INSERT ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION finance_source_guard()`
- `CREATE TRIGGER finance_immutable BEFORE DELETE OR UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION finance_immutable()`

## financial_postings

| Column | Type | Null | Default/identity |
|---|---|---|---|
| transaction_id | bigint | NO | — |
| line_no | smallint | NO | — |
| account_id | bigint | NO | — |
| side | character(1) | NO | — |
| amount_satang | bigint | NO | — |

Constraints:

- `finance_balanced_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `financial_postings_account_id_fkey`: `FOREIGN KEY (account_id) REFERENCES financial_accounts(id)`
- `financial_postings_amount_satang_check`: `CHECK ((amount_satang > 0))`
- `financial_postings_line_no_check`: `CHECK ((line_no > 0))`
- `financial_postings_pkey`: `PRIMARY KEY (transaction_id, line_no)`
- `financial_postings_side_check`: `CHECK ((side = ANY (ARRAY['D'::bpchar, 'C'::bpchar])))`
- `financial_postings_transaction_id_account_id_key`: `UNIQUE (transaction_id, account_id)`
- `financial_postings_transaction_id_fkey`: `FOREIGN KEY (transaction_id) REFERENCES financial_transactions(id)`

Indexes:

- `CREATE UNIQUE INDEX financial_postings_pkey ON public.financial_postings USING btree (transaction_id, line_no)`
- `CREATE UNIQUE INDEX financial_postings_transaction_id_account_id_key ON public.financial_postings USING btree (transaction_id, account_id)`
- `CREATE INDEX finance_posting_account_idx ON public.financial_postings USING btree (account_id, transaction_id) INCLUDE (side, amount_satang)`

Triggers:

- `CREATE TRIGGER finance_posting_insert_guard BEFORE INSERT ON public.financial_postings FOR EACH ROW EXECUTE FUNCTION finance_posting_insert_guard()`
- `CREATE CONSTRAINT TRIGGER finance_balanced_guard AFTER INSERT ON public.financial_postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_balanced_guard()`
- `CREATE TRIGGER finance_immutable BEFORE DELETE OR UPDATE ON public.financial_postings FOR EACH ROW EXECUTE FUNCTION finance_immutable()`

## merchant_payout_accounts

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| merchant_id | integer | NO | — |
| account_type | character varying(20) | NO | — |
| bank_code | character varying(20) | NO | — |
| masked_account | character varying(40) | NO | — |
| encrypted_account | text | NO | — |
| status | character varying(24) | NO | 'PENDING_VERIFICATION'::character varying |
| is_current | boolean | NO | false |
| requested_by_staff_id | integer | NO | — |
| verified_by_admin_id | integer | YES | — |
| verified_at | timestamp with time zone | YES | — |
| created_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `merchant_payout_accounts_account_type_check`: `CHECK (((account_type)::text = ANY ((ARRAY['BANK_ACCOUNT'::character varying, 'PROMPTPAY'::character varying])::text[])))`
- `merchant_payout_accounts_check`: `CHECK (((NOT is_current) OR (((status)::text = 'VERIFIED'::text) AND (verified_at IS NOT NULL) AND (verified_by_admin_id IS NOT NULL))))`
- `merchant_payout_accounts_encrypted_account_check`: `CHECK ((encrypted_account ~~ 'v1.%'::text))`
- `merchant_payout_accounts_id_merchant_id_key`: `UNIQUE (id, merchant_id)`
- `merchant_payout_accounts_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT`
- `merchant_payout_accounts_pkey`: `PRIMARY KEY (id)`
- `merchant_payout_accounts_requested_by_staff_id_merchant_id_fkey`: `FOREIGN KEY (requested_by_staff_id, merchant_id) REFERENCES merchant_staffs(id, merchant_id)`
- `merchant_payout_accounts_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PENDING_VERIFICATION'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying, 'RETIRED'::character varying])::text[])))`
- `merchant_payout_accounts_verified_by_admin_id_fkey`: `FOREIGN KEY (verified_by_admin_id) REFERENCES platform_admins(id)`

Indexes:

- `CREATE UNIQUE INDEX merchant_payout_accounts_pkey ON public.merchant_payout_accounts USING btree (id)`
- `CREATE UNIQUE INDEX merchant_payout_accounts_id_merchant_id_key ON public.merchant_payout_accounts USING btree (id, merchant_id)`
- `CREATE UNIQUE INDEX finance_current_account_idx ON public.merchant_payout_accounts USING btree (merchant_id) WHERE is_current`

Triggers:

- `CREATE TRIGGER finance_business_guard BEFORE DELETE OR UPDATE ON public.merchant_payout_accounts FOR EACH ROW EXECUTE FUNCTION finance_business_guard()`

## merchant_withdrawals

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| merchant_id | integer | NO | — |
| payout_account_id | uuid | NO | — |
| requested_by_staff_id | integer | YES | — |
| settlement_window | character varying(80) | YES | — |
| idempotency_key | character varying(128) | NO | — |
| fingerprint | character(64) | NO | — |
| amount_satang | bigint | NO | — |
| status | character varying(24) | NO | 'REQUESTED'::character varying |
| account_review_required | boolean | NO | false |
| reviewed_by_admin_id | integer | YES | — |
| reviewed_at | timestamp with time zone | YES | — |
| paid_by_admin_id | integer | YES | — |
| paid_at | timestamp with time zone | YES | — |
| reason | character varying(500) | YES | — |
| created_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `finance_state_posting_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `merchant_withdrawals_amount_satang_check`: `CHECK ((amount_satang >= 30000))`
- `merchant_withdrawals_check`: `CHECK ((((status)::text = 'PAID'::text) = (paid_at IS NOT NULL)))`
- `merchant_withdrawals_check1`: `CHECK (((paid_at IS NULL) = (paid_by_admin_id IS NULL)))`
- `merchant_withdrawals_id_merchant_id_key`: `UNIQUE (id, merchant_id)`
- `merchant_withdrawals_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `merchant_withdrawals_merchant_id_idempotency_key_key`: `UNIQUE (merchant_id, idempotency_key)`
- `merchant_withdrawals_merchant_id_settlement_window_key`: `UNIQUE (merchant_id, settlement_window)`
- `merchant_withdrawals_paid_by_admin_id_fkey`: `FOREIGN KEY (paid_by_admin_id) REFERENCES platform_admins(id)`
- `merchant_withdrawals_payout_account_id_merchant_id_fkey`: `FOREIGN KEY (payout_account_id, merchant_id) REFERENCES merchant_payout_accounts(id, merchant_id)`
- `merchant_withdrawals_pkey`: `PRIMARY KEY (id)`
- `merchant_withdrawals_requested_by_staff_id_merchant_id_fkey`: `FOREIGN KEY (requested_by_staff_id, merchant_id) REFERENCES merchant_staffs(id, merchant_id)`
- `merchant_withdrawals_reviewed_by_admin_id_fkey`: `FOREIGN KEY (reviewed_by_admin_id) REFERENCES platform_admins(id)`
- `merchant_withdrawals_status_check`: `CHECK (((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'APPROVED'::character varying, 'PROCESSING'::character varying, 'PAID'::character varying, 'REJECTED'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[])))`

Indexes:

- `CREATE UNIQUE INDEX merchant_withdrawals_pkey ON public.merchant_withdrawals USING btree (id)`
- `CREATE UNIQUE INDEX merchant_withdrawals_id_merchant_id_key ON public.merchant_withdrawals USING btree (id, merchant_id)`
- `CREATE UNIQUE INDEX merchant_withdrawals_merchant_id_idempotency_key_key ON public.merchant_withdrawals USING btree (merchant_id, idempotency_key)`
- `CREATE UNIQUE INDEX merchant_withdrawals_merchant_id_settlement_window_key ON public.merchant_withdrawals USING btree (merchant_id, settlement_window)`
- `CREATE UNIQUE INDEX finance_one_open_withdrawal_idx ON public.merchant_withdrawals USING btree (merchant_id) WHERE ((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'APPROVED'::character varying, 'PROCESSING'::character varying])::text[]))`
- `CREATE INDEX finance_withdrawals_queue_idx ON public.merchant_withdrawals USING btree (status, created_at)`

Triggers:

- `CREATE CONSTRAINT TRIGGER finance_state_posting_guard AFTER INSERT OR UPDATE ON public.merchant_withdrawals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_state_posting_guard()`
- `CREATE TRIGGER finance_business_guard BEFORE DELETE OR UPDATE ON public.merchant_withdrawals FOR EACH ROW EXECUTE FUNCTION finance_business_guard()`

## finance_refunds

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| order_id | integer | NO | — |
| merchant_id | integer | NO | — |
| idempotency_key | character varying(128) | NO | — |
| fingerprint | character(64) | NO | — |
| status | character varying(24) | NO | 'APPROVED'::character varying |
| food_satang | bigint | NO | — |
| delivery_satang | bigint | NO | — |
| merchant_food_discount_satang | bigint | NO | — |
| merchant_delivery_discount_satang | bigint | NO | — |
| platform_food_discount_satang | bigint | NO | — |
| platform_delivery_discount_satang | bigint | NO | — |
| commission_satang | bigint | NO | — |
| subsidy_satang | bigint | NO | — |
| merchant_recovery_satang | bigint | NO | — |
| customer_refund_satang | bigint | NO | — |
| encrypted_destination | text | YES | — |
| destination_masked | character varying(40) | YES | — |
| destination_bank_code | character varying(20) | YES | — |
| reason | character varying(500) | NO | — |
| approved_by_admin_id | integer | NO | — |
| created_at | timestamp with time zone | NO | clock_timestamp() |
| paid_at | timestamp with time zone | YES | — |

Constraints:

- `finance_refund_cap_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `finance_refunds_approved_by_admin_id_fkey`: `FOREIGN KEY (approved_by_admin_id) REFERENCES platform_admins(id)`
- `finance_refunds_check`: `CHECK (((food_satang + delivery_satang) > 0))`
- `finance_refunds_check1`: `CHECK (((customer_refund_satang = 0) OR ((encrypted_destination ~~ 'v1.%'::text) AND (encrypted_destination IS NOT NULL) AND (destination_masked IS NOT NULL) AND (destination_bank_code IS NOT NULL))))`
- `finance_refunds_check2`: `CHECK ((customer_refund_satang = ((merchant_recovery_satang + commission_satang) - subsidy_satang)))`
- `finance_refunds_check3`: `CHECK ((subsidy_satang = (platform_food_discount_satang + platform_delivery_discount_satang)))`
- `finance_refunds_check4`: `CHECK ((customer_refund_satang = ((((food_satang + delivery_satang) - merchant_food_discount_satang) - merchant_delivery_discount_satang) - subsidy_satang)))`
- `finance_refunds_commission_satang_check`: `CHECK ((commission_satang >= 0))`
- `finance_refunds_customer_refund_satang_check`: `CHECK ((customer_refund_satang >= 0))`
- `finance_refunds_delivery_satang_check`: `CHECK ((delivery_satang >= 0))`
- `finance_refunds_food_satang_check`: `CHECK ((food_satang >= 0))`
- `finance_refunds_id_merchant_id_key`: `UNIQUE (id, merchant_id)`
- `finance_refunds_merchant_delivery_discount_satang_check`: `CHECK ((merchant_delivery_discount_satang >= 0))`
- `finance_refunds_merchant_food_discount_satang_check`: `CHECK ((merchant_food_discount_satang >= 0))`
- `finance_refunds_merchant_id_idempotency_key_key`: `UNIQUE (merchant_id, idempotency_key)`
- `finance_refunds_merchant_recovery_satang_check`: `CHECK ((merchant_recovery_satang >= 0))`
- `finance_refunds_order_id_merchant_id_fkey`: `FOREIGN KEY (order_id, merchant_id) REFERENCES order_financial_snapshots(order_id, merchant_id)`
- `finance_refunds_pkey`: `PRIMARY KEY (id)`
- `finance_refunds_platform_delivery_discount_satang_check`: `CHECK ((platform_delivery_discount_satang >= 0))`
- `finance_refunds_platform_food_discount_satang_check`: `CHECK ((platform_food_discount_satang >= 0))`
- `finance_refunds_status_check`: `CHECK (((status)::text = ANY ((ARRAY['APPROVED'::character varying, 'PROCESSING'::character varying, 'PAID'::character varying])::text[])))`
- `finance_refunds_subsidy_satang_check`: `CHECK ((subsidy_satang >= 0))`
- `finance_state_posting_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

Indexes:

- `CREATE UNIQUE INDEX finance_refunds_pkey ON public.finance_refunds USING btree (id)`
- `CREATE UNIQUE INDEX finance_refunds_id_merchant_id_key ON public.finance_refunds USING btree (id, merchant_id)`
- `CREATE UNIQUE INDEX finance_refunds_merchant_id_idempotency_key_key ON public.finance_refunds USING btree (merchant_id, idempotency_key)`
- `CREATE INDEX finance_refunds_order_idx ON public.finance_refunds USING btree (order_id)`

Triggers:

- `CREATE CONSTRAINT TRIGGER finance_refund_cap_guard AFTER INSERT ON public.finance_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_refund_cap_guard()`
- `CREATE CONSTRAINT TRIGGER finance_state_posting_guard AFTER INSERT OR UPDATE ON public.finance_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_state_posting_guard()`
- `CREATE TRIGGER finance_business_guard BEFORE DELETE OR UPDATE ON public.finance_refunds FOR EACH ROW EXECUTE FUNCTION finance_business_guard()`

## finance_transfers

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| merchant_id | integer | NO | — |
| withdrawal_id | uuid | YES | — |
| refund_id | uuid | YES | — |
| recipient_version_id | uuid | NO | — |
| source_account_key | character(64) | NO | — |
| provider | character varying(40) | NO | 'BANK'::character varying |
| amount_satang | bigint | NO | — |
| status | character varying(16) | NO | 'STARTED'::character varying |
| external_reference | character varying(160) | YES | — |
| evidence_object_key | character varying(512) | YES | — |
| initiated_by_admin_id | integer | NO | — |
| confirmed_by_admin_id | integer | YES | — |
| confirmed_at | timestamp with time zone | YES | — |
| created_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `finance_reference_normalized_ck`: `CHECK (((external_reference IS NULL) OR (((external_reference)::text = upper(regexp_replace((external_reference)::text, '[[:space:]]'::text, ''::text, 'g'::text))) AND ((external_reference)::text ~ '^[A-Z0-9][A-Z0-9_.:/-]{2,159}$'::text))))`
- `finance_state_posting_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `finance_transfers_amount_satang_check`: `CHECK ((amount_satang > 0))`
- `finance_transfers_check`: `CHECK ((num_nonnulls(withdrawal_id, refund_id) = 1))`
- `finance_transfers_check1`: `CHECK ((((status)::text <> 'CONFIRMED'::text) OR ((external_reference IS NOT NULL) AND (length(btrim((external_reference)::text)) > 0) AND (confirmed_at IS NOT NULL) AND (confirmed_by_admin_id IS NOT NULL))))`
- `finance_transfers_confirmed_by_admin_id_fkey`: `FOREIGN KEY (confirmed_by_admin_id) REFERENCES platform_admins(id)`
- `finance_transfers_evidence_object_key_check`: `CHECK (((evidence_object_key IS NULL) OR ((evidence_object_key)::text ~ '^finance-proofs/[0-9]{4}/[0-9]{2}/[a-f0-9-]+[.](png\|jpg\|webp)$'::text)))`
- `finance_transfers_initiated_by_admin_id_fkey`: `FOREIGN KEY (initiated_by_admin_id) REFERENCES platform_admins(id)`
- `finance_transfers_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `finance_transfers_pkey`: `PRIMARY KEY (id)`
- `finance_transfers_recipient_version_id_fkey`: `FOREIGN KEY (recipient_version_id) REFERENCES platform_payment_recipients(id)`
- `finance_transfers_refund_id_merchant_id_fkey`: `FOREIGN KEY (refund_id, merchant_id) REFERENCES finance_refunds(id, merchant_id)`
- `finance_transfers_status_check`: `CHECK (((status)::text = ANY ((ARRAY['STARTED'::character varying, 'CONFIRMED'::character varying, 'FAILED'::character varying, 'UNKNOWN'::character varying])::text[])))`
- `finance_transfers_withdrawal_id_merchant_id_fkey`: `FOREIGN KEY (withdrawal_id, merchant_id) REFERENCES merchant_withdrawals(id, merchant_id)`

Indexes:

- `CREATE UNIQUE INDEX finance_transfers_pkey ON public.finance_transfers USING btree (id)`
- `CREATE UNIQUE INDEX finance_bank_reference_uq ON public.finance_transfers USING btree (provider, source_account_key, external_reference) WHERE (external_reference IS NOT NULL)`
- `CREATE UNIQUE INDEX finance_transfer_withdrawal_uq ON public.finance_transfers USING btree (withdrawal_id) WHERE ((status)::text <> 'FAILED'::text)`
- `CREATE UNIQUE INDEX finance_transfer_refund_uq ON public.finance_transfers USING btree (refund_id) WHERE ((status)::text <> 'FAILED'::text)`

Triggers:

- `CREATE CONSTRAINT TRIGGER finance_state_posting_guard AFTER INSERT OR UPDATE ON public.finance_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_state_posting_guard()`
- `CREATE TRIGGER finance_business_guard BEFORE DELETE OR UPDATE ON public.finance_transfers FOR EACH ROW EXECUTE FUNCTION finance_business_guard()`

## advertising_orders

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| merchant_id | integer | NO | — |
| banner_id | integer | NO | — |
| requested_by_staff_id | integer | NO | — |
| idempotency_key | character varying(128) | NO | — |
| fingerprint | character(64) | NO | — |
| fee_satang | bigint | NO | 30000 |
| duration_days | integer | NO | 30 |
| pricing_version | character varying(40) | NO | 'AD_V1'::character varying |
| status | character varying(24) | NO | 'PAID_PENDING_REVIEW'::character varying |
| activated_at | timestamp with time zone | YES | — |
| scheduled_end_at | timestamp with time zone | YES | — |
| terminated_at | timestamp with time zone | YES | — |
| termination_reason | character varying(500) | YES | — |
| served_satang | bigint | NO | 0 |
| forfeited_satang | bigint | NO | 0 |
| unserved_satang | bigint | NO | 30000 |
| refunded_satang | bigint | NO | 0 |
| consented_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `advertising_orders_banner_id_fkey`: `FOREIGN KEY (banner_id) REFERENCES banners(id)`
- `advertising_orders_check`: `CHECK ((((served_satang + unserved_satang) = fee_satang) AND ((refunded_satang + forfeited_satang) <= unserved_satang)))`
- `advertising_orders_check1`: `CHECK (((scheduled_end_at IS NULL) OR (EXTRACT(epoch FROM (scheduled_end_at - activated_at)) = (2592000)::numeric)))`
- `advertising_orders_duration_days_check`: `CHECK ((duration_days = 30))`
- `advertising_orders_fee_satang_check`: `CHECK ((fee_satang = 30000))`
- `advertising_orders_forfeited_satang_check`: `CHECK ((forfeited_satang >= 0))`
- `advertising_orders_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `advertising_orders_merchant_id_idempotency_key_key`: `UNIQUE (merchant_id, idempotency_key)`
- `advertising_orders_pkey`: `PRIMARY KEY (id)`
- `advertising_orders_refunded_satang_check`: `CHECK ((refunded_satang >= 0))`
- `advertising_orders_requested_by_staff_id_merchant_id_fkey`: `FOREIGN KEY (requested_by_staff_id, merchant_id) REFERENCES merchant_staffs(id, merchant_id)`
- `advertising_orders_served_satang_check`: `CHECK ((served_satang >= 0))`
- `advertising_orders_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PAID_PENDING_REVIEW'::character varying, 'ACTIVE'::character varying, 'EXPIRED'::character varying, 'REJECTED_REFUNDED'::character varying, 'CANCELLED'::character varying, 'TERMINATED'::character varying])::text[])))`
- `advertising_orders_unserved_satang_check`: `CHECK ((unserved_satang >= 0))`
- `finance_state_posting_guard`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`

Indexes:

- `CREATE UNIQUE INDEX advertising_orders_pkey ON public.advertising_orders USING btree (id)`
- `CREATE UNIQUE INDEX advertising_orders_merchant_id_idempotency_key_key ON public.advertising_orders USING btree (merchant_id, idempotency_key)`
- `CREATE UNIQUE INDEX finance_active_ad_uq ON public.advertising_orders USING btree (banner_id) WHERE ((status)::text = ANY ((ARRAY['PAID_PENDING_REVIEW'::character varying, 'ACTIVE'::character varying])::text[]))`

Triggers:

- `CREATE TRIGGER finance_ad_ownership_guard BEFORE INSERT OR UPDATE ON public.advertising_orders FOR EACH ROW EXECUTE FUNCTION finance_ad_ownership_guard()`
- `CREATE CONSTRAINT TRIGGER finance_state_posting_guard AFTER INSERT OR UPDATE ON public.advertising_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_state_posting_guard()`
- `CREATE TRIGGER finance_business_guard BEFORE DELETE OR UPDATE ON public.advertising_orders FOR EACH ROW EXECUTE FUNCTION finance_business_guard()`

## finance_reconciliation_cases

| Column | Type | Null | Default/identity |
|---|---|---|---|
| id | uuid | NO | — |
| case_key | character varying(180) | NO | — |
| kind | character varying(64) | NO | — |
| merchant_id | integer | YES | — |
| order_id | integer | YES | — |
| facts | jsonb | NO | '{}'::jsonb |
| status | character varying(16) | NO | 'OPEN'::character varying |
| created_at | timestamp with time zone | NO | clock_timestamp() |

Constraints:

- `finance_reconciliation_cases_case_key_key`: `UNIQUE (case_key)`
- `finance_reconciliation_cases_merchant_id_fkey`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `finance_reconciliation_cases_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `finance_reconciliation_cases_pkey`: `PRIMARY KEY (id)`
- `finance_reconciliation_cases_status_check`: `CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'RESOLVED'::character varying])::text[])))`

Indexes:

- `CREATE UNIQUE INDEX finance_reconciliation_cases_pkey ON public.finance_reconciliation_cases USING btree (id)`
- `CREATE UNIQUE INDEX finance_reconciliation_cases_case_key_key ON public.finance_reconciliation_cases USING btree (case_key)`

Triggers:

- `CREATE TRIGGER finance_business_guard BEFORE DELETE OR UPDATE ON public.finance_reconciliation_cases FOR EACH ROW EXECUTE FUNCTION finance_business_guard()`

