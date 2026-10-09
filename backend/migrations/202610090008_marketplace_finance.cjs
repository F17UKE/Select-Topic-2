// Additive only. No opening balances, historical commission or active cutover is seeded.
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE finance_policy_versions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      version varchar(40) NOT NULL UNIQUE,
      commission_bps integer NOT NULL DEFAULT 500 CHECK (commission_bps = 500),
      calculation_version varchar(40) NOT NULL DEFAULT 'FINANCE_V1' CHECK (calculation_version = 'FINANCE_V1'),
      minimum_withdrawal_satang bigint NOT NULL DEFAULT 30000 CHECK (minimum_withdrawal_satang = 30000),
      maximum_withdrawal_satang bigint CHECK (maximum_withdrawal_satang IS NULL),
      withdrawal_fee_satang bigint NOT NULL DEFAULT 0 CHECK (withdrawal_fee_satang = 0),
      approved_by_admin_id integer NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE platform_payment_recipients (
      id uuid PRIMARY KEY, version varchar(80) NOT NULL UNIQUE,
      identity_type varchar(24) NOT NULL CHECK (identity_type IN ('PHONE','NATIONAL_ID','TAX_ID','EWALLET')),
      display_name varchar(120) NOT NULL, masked_identity varchar(40) NOT NULL,
      encrypted_identity text NOT NULL CHECK (encrypted_identity LIKE 'v1.%'),
      source_account_key char(64) NOT NULL,
      created_by_admin_id integer NOT NULL REFERENCES platform_admins(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE merchants ADD COLUMN payout_account_changed_at timestamptz;
    ALTER TABLE merchants ADD COLUMN settlement_mode varchar(24) NOT NULL DEFAULT 'MANUAL_WITHDRAWAL'
      CHECK (settlement_mode IN ('MANUAL_WITHDRAWAL','AUTO_3_DAYS'));
    ALTER TABLE orders ADD COLUMN collection_mode varchar(24) NOT NULL DEFAULT 'LEGACY_DIRECT';
    ALTER TABLE orders ADD COLUMN payment_recipient_version_id uuid REFERENCES platform_payment_recipients(id) ON DELETE RESTRICT;
    ALTER TABLE orders ADD CONSTRAINT orders_finance_route_ck CHECK
      ((collection_mode = 'LEGACY_DIRECT' AND payment_recipient_version_id IS NULL) OR
       (collection_mode = 'PLATFORM' AND payment_recipient_version_id IS NOT NULL));
    ALTER TABLE orders ADD CONSTRAINT orders_finance_recipient_uq UNIQUE (id,payment_recipient_version_id);
    ALTER TABLE payments ADD COLUMN payment_recipient_version_id uuid;
    ALTER TABLE payments ADD CONSTRAINT payments_finance_route_fk FOREIGN KEY (order_id,payment_recipient_version_id)
      REFERENCES orders(id,payment_recipient_version_id) ON DELETE RESTRICT;
    ALTER TABLE payments ADD CONSTRAINT payments_finance_order_uq UNIQUE (id,order_id);
    CREATE INDEX orders_finance_mode_idx ON orders(collection_mode,created_at);
    CREATE INDEX payments_finance_route_idx ON payments(order_id,payment_recipient_version_id);
    ALTER TABLE promotions ADD COLUMN funding_source varchar(16) NOT NULL DEFAULT 'LEGACY_UNKNOWN'
      CHECK (funding_source IN ('LEGACY_UNKNOWN','MERCHANT','PLATFORM'));
    ALTER TABLE coupons ADD COLUMN funding_source varchar(16) NOT NULL DEFAULT 'LEGACY_UNKNOWN'
      CHECK (funding_source IN ('LEGACY_UNKNOWN','MERCHANT','PLATFORM'));
    ALTER TABLE promotions ALTER COLUMN funding_source DROP DEFAULT;
    ALTER TABLE coupons ALTER COLUMN funding_source DROP DEFAULT;
    CREATE FUNCTION finance_funding_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.funding_source = 'LEGACY_UNKNOWN' AND (TG_OP = 'INSERT' OR OLD.funding_source <> 'LEGACY_UNKNOWN') THEN
        RAISE EXCEPTION 'finance_funding_required' USING ERRCODE='23514';
      END IF; RETURN NEW; END $$;
    CREATE TRIGGER finance_funding_guard BEFORE INSERT OR UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION finance_funding_guard();
    CREATE TRIGGER finance_funding_guard BEFORE INSERT OR UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION finance_funding_guard();
    CREATE TABLE order_financial_snapshots (
      order_id integer PRIMARY KEY, merchant_id integer NOT NULL, paid_payment_id integer NOT NULL UNIQUE,
      recipient_version_id uuid NOT NULL, policy_version_id bigint NOT NULL REFERENCES finance_policy_versions(id),
      commission_bps integer NOT NULL DEFAULT 500 CHECK (commission_bps=500),
      calculation_version varchar(40) NOT NULL DEFAULT 'FINANCE_V1' CHECK (calculation_version='FINANCE_V1'),
      food_subtotal_satang bigint NOT NULL CHECK (food_subtotal_satang >= 0),
      delivery_fee_satang bigint NOT NULL CHECK (delivery_fee_satang >= 0),
      merchant_food_discount_satang bigint NOT NULL CHECK (merchant_food_discount_satang >= 0),
      merchant_delivery_discount_satang bigint NOT NULL CHECK (merchant_delivery_discount_satang >= 0),
      platform_food_discount_satang bigint NOT NULL CHECK (platform_food_discount_satang >= 0),
      platform_delivery_discount_satang bigint NOT NULL CHECK (platform_delivery_discount_satang >= 0),
      commission_base_satang bigint NOT NULL CHECK (commission_base_satang >= 0),
      commission_satang bigint NOT NULL CHECK (commission_satang >= 0),
      platform_subsidy_satang bigint NOT NULL CHECK (platform_subsidy_satang >= 0),
      merchant_entitlement_satang bigint NOT NULL CHECK (merchant_entitlement_satang >= 0),
      customer_paid_satang bigint NOT NULL CHECK (customer_paid_satang > 0),
      paid_at timestamptz NOT NULL,
      UNIQUE (order_id,merchant_id),
      FOREIGN KEY (order_id,merchant_id) REFERENCES orders(id,merchant_id) ON DELETE RESTRICT,
      FOREIGN KEY (paid_payment_id,order_id) REFERENCES payments(id,order_id) ON DELETE RESTRICT,
      FOREIGN KEY (order_id,recipient_version_id) REFERENCES orders(id,payment_recipient_version_id) ON DELETE RESTRICT,
      CHECK (merchant_food_discount_satang + platform_food_discount_satang <= food_subtotal_satang),
      CHECK (merchant_delivery_discount_satang + platform_delivery_discount_satang <= delivery_fee_satang),
      CHECK (commission_base_satang = food_subtotal_satang - merchant_food_discount_satang),
      CHECK (commission_satang = floor((commission_base_satang::numeric * 500 + 5000)/10000)),
      CHECK (platform_subsidy_satang = platform_food_discount_satang + platform_delivery_discount_satang),
      CHECK (merchant_entitlement_satang = commission_base_satang + delivery_fee_satang - merchant_delivery_discount_satang - commission_satang),
      CHECK (customer_paid_satang = merchant_entitlement_satang + commission_satang - platform_subsidy_satang)
    );
    CREATE INDEX finance_snapshot_merchant_idx ON order_financial_snapshots(merchant_id,paid_at);
    CREATE TABLE financial_accounts (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      merchant_id integer REFERENCES merchants(id) ON DELETE RESTRICT,
      kind varchar(32) NOT NULL,
      UNIQUE NULLS NOT DISTINCT (merchant_id,kind),
      CHECK ((merchant_id IS NOT NULL AND kind IN ('MERCHANT_PENDING','MERCHANT_AVAILABLE','MERCHANT_RESERVED','MERCHANT_HELD','MERCHANT_DEBT')) OR
        (merchant_id IS NULL AND kind IN ('CASH_CLEARING','BANK','COMMISSION_DEFERRED','COMMISSION_REVENUE','SUBSIDY_EXPENSE','REFUND_PAYABLE','AD_DEFERRED','AD_REVENUE')))
    );
    CREATE TABLE merchant_payout_accounts (
      id uuid PRIMARY KEY, merchant_id integer NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
      account_type varchar(20) NOT NULL CHECK (account_type IN ('BANK_ACCOUNT','PROMPTPAY')),
      bank_code varchar(20) NOT NULL, masked_account varchar(40) NOT NULL,
      encrypted_account text NOT NULL CHECK (encrypted_account LIKE 'v1.%'),
      status varchar(24) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','RETIRED')),
      is_current boolean NOT NULL DEFAULT false,
      requested_by_staff_id integer NOT NULL,
      verified_by_admin_id integer REFERENCES platform_admins(id), verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(id,merchant_id),
      FOREIGN KEY (requested_by_staff_id,merchant_id) REFERENCES merchant_staffs(id,merchant_id),
      CHECK (NOT is_current OR (status='VERIFIED' AND verified_at IS NOT NULL AND verified_by_admin_id IS NOT NULL))
    );
    CREATE UNIQUE INDEX finance_current_account_idx ON merchant_payout_accounts(merchant_id) WHERE is_current;
    CREATE TABLE merchant_withdrawals (
      id uuid PRIMARY KEY, merchant_id integer NOT NULL REFERENCES merchants(id),
      payout_account_id uuid NOT NULL,
      requested_by_staff_id integer,
      settlement_window varchar(80),
      idempotency_key varchar(128) NOT NULL, fingerprint char(64) NOT NULL,
      amount_satang bigint NOT NULL CHECK (amount_satang>=30000),
      status varchar(24) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','PROCESSING','PAID','REJECTED','FAILED','CANCELLED')),
      account_review_required boolean NOT NULL DEFAULT false,
      reviewed_by_admin_id integer REFERENCES platform_admins(id), reviewed_at timestamptz,
      paid_by_admin_id integer REFERENCES platform_admins(id), paid_at timestamptz,
      reason varchar(500), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(id,merchant_id), UNIQUE(merchant_id,idempotency_key), UNIQUE(merchant_id,settlement_window),
      FOREIGN KEY(payout_account_id,merchant_id) REFERENCES merchant_payout_accounts(id,merchant_id),
      FOREIGN KEY(requested_by_staff_id,merchant_id) REFERENCES merchant_staffs(id,merchant_id),
      CHECK ((status='PAID') = (paid_at IS NOT NULL)), CHECK ((paid_at IS NULL) = (paid_by_admin_id IS NULL))
    );
    CREATE UNIQUE INDEX finance_one_open_withdrawal_idx ON merchant_withdrawals(merchant_id) WHERE status IN ('REQUESTED','APPROVED','PROCESSING');
    CREATE INDEX finance_withdrawals_queue_idx ON merchant_withdrawals(status,created_at);
    CREATE TABLE finance_refunds (
      id uuid PRIMARY KEY, order_id integer NOT NULL, merchant_id integer NOT NULL,
      idempotency_key varchar(128) NOT NULL, fingerprint char(64) NOT NULL,
      status varchar(24) NOT NULL DEFAULT 'APPROVED' CHECK(status IN ('APPROVED','PROCESSING','PAID')),
      food_satang bigint NOT NULL CHECK(food_satang>=0), delivery_satang bigint NOT NULL CHECK(delivery_satang>=0),
      merchant_food_discount_satang bigint NOT NULL CHECK(merchant_food_discount_satang>=0),
      merchant_delivery_discount_satang bigint NOT NULL CHECK(merchant_delivery_discount_satang>=0),
      platform_food_discount_satang bigint NOT NULL CHECK(platform_food_discount_satang>=0),
      platform_delivery_discount_satang bigint NOT NULL CHECK(platform_delivery_discount_satang>=0),
      commission_satang bigint NOT NULL CHECK(commission_satang>=0), subsidy_satang bigint NOT NULL CHECK(subsidy_satang>=0),
      merchant_recovery_satang bigint NOT NULL CHECK(merchant_recovery_satang>=0),
      customer_refund_satang bigint NOT NULL CHECK(customer_refund_satang>=0),
      encrypted_destination text, destination_masked varchar(40), destination_bank_code varchar(20),
      reason varchar(500) NOT NULL, approved_by_admin_id integer NOT NULL REFERENCES platform_admins(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), paid_at timestamptz,
      UNIQUE(id,merchant_id), UNIQUE(merchant_id,idempotency_key),
      FOREIGN KEY(order_id,merchant_id) REFERENCES order_financial_snapshots(order_id,merchant_id),
      CHECK (food_satang+delivery_satang>0),
      CHECK (customer_refund_satang=0 OR (encrypted_destination LIKE 'v1.%' AND encrypted_destination IS NOT NULL AND destination_masked IS NOT NULL AND destination_bank_code IS NOT NULL)),
      CHECK (customer_refund_satang=merchant_recovery_satang+commission_satang-subsidy_satang),
      CHECK (subsidy_satang=platform_food_discount_satang+platform_delivery_discount_satang),
      CHECK (customer_refund_satang=food_satang+delivery_satang-merchant_food_discount_satang-merchant_delivery_discount_satang-subsidy_satang)
    );
    CREATE INDEX finance_refunds_order_idx ON finance_refunds(order_id);
    CREATE TABLE finance_transfers (
      id uuid PRIMARY KEY, merchant_id integer NOT NULL REFERENCES merchants(id),
      withdrawal_id uuid, refund_id uuid,
      recipient_version_id uuid NOT NULL REFERENCES platform_payment_recipients(id),
      source_account_key char(64) NOT NULL, provider varchar(40) NOT NULL DEFAULT 'BANK',
      amount_satang bigint NOT NULL CHECK(amount_satang>0),
      status varchar(16) NOT NULL DEFAULT 'STARTED' CHECK(status IN ('STARTED','CONFIRMED','FAILED','UNKNOWN')),
      external_reference varchar(160), evidence_object_key varchar(512),
      initiated_by_admin_id integer NOT NULL REFERENCES platform_admins(id),
      confirmed_by_admin_id integer REFERENCES platform_admins(id), confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(withdrawal_id,merchant_id) REFERENCES merchant_withdrawals(id,merchant_id),
      FOREIGN KEY(refund_id,merchant_id) REFERENCES finance_refunds(id,merchant_id),
      CHECK(num_nonnulls(withdrawal_id,refund_id)=1),
      CHECK(status<>'CONFIRMED' OR (external_reference IS NOT NULL AND length(btrim(external_reference))>0 AND confirmed_at IS NOT NULL AND confirmed_by_admin_id IS NOT NULL)),
      CHECK(evidence_object_key IS NULL OR evidence_object_key ~ '^finance-proofs/[0-9]{4}/[0-9]{2}/[a-f0-9-]+[.](png|jpg|webp)$')
    );
    CREATE UNIQUE INDEX finance_bank_reference_uq ON finance_transfers(provider,source_account_key,external_reference) WHERE external_reference IS NOT NULL;
    CREATE UNIQUE INDEX finance_transfer_withdrawal_uq ON finance_transfers(withdrawal_id) WHERE status<>'FAILED';
    CREATE UNIQUE INDEX finance_transfer_refund_uq ON finance_transfers(refund_id) WHERE status<>'FAILED';
    CREATE TABLE advertising_orders (
      id uuid PRIMARY KEY, merchant_id integer NOT NULL REFERENCES merchants(id), banner_id integer NOT NULL REFERENCES banners(id),
      requested_by_staff_id integer NOT NULL, idempotency_key varchar(128) NOT NULL, fingerprint char(64) NOT NULL,
      fee_satang bigint NOT NULL DEFAULT 30000 CHECK(fee_satang=30000), duration_days integer NOT NULL DEFAULT 30 CHECK(duration_days=30),
      pricing_version varchar(40) NOT NULL DEFAULT 'AD_V1',
      status varchar(24) NOT NULL DEFAULT 'PAID_PENDING_REVIEW' CHECK(status IN ('PAID_PENDING_REVIEW','ACTIVE','EXPIRED','REJECTED_REFUNDED','CANCELLED','TERMINATED')),
      activated_at timestamptz, scheduled_end_at timestamptz, terminated_at timestamptz, termination_reason varchar(500),
      served_satang bigint NOT NULL DEFAULT 0 CHECK(served_satang>=0),
      forfeited_satang bigint NOT NULL DEFAULT 0 CHECK(forfeited_satang>=0),
      unserved_satang bigint NOT NULL DEFAULT 30000 CHECK(unserved_satang>=0),
      refunded_satang bigint NOT NULL DEFAULT 0 CHECK(refunded_satang>=0),
      consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(merchant_id,idempotency_key),
      FOREIGN KEY(requested_by_staff_id,merchant_id) REFERENCES merchant_staffs(id,merchant_id),
      CHECK(served_satang+unserved_satang=fee_satang AND refunded_satang+forfeited_satang<=unserved_satang),
      CHECK(scheduled_end_at IS NULL OR extract(epoch FROM(scheduled_end_at-activated_at))=2592000)
    );
    CREATE UNIQUE INDEX finance_active_ad_uq ON advertising_orders(banner_id) WHERE status IN ('PAID_PENDING_REVIEW','ACTIVE');
    CREATE TABLE finance_reconciliation_cases (
      id uuid PRIMARY KEY, case_key varchar(180) NOT NULL UNIQUE, kind varchar(64) NOT NULL,
      merchant_id integer REFERENCES merchants(id), order_id integer REFERENCES orders(id),
      facts jsonb NOT NULL DEFAULT '{}', status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE financial_transactions (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, merchant_id integer NOT NULL REFERENCES merchants(id),
      event_key varchar(180) NOT NULL UNIQUE CHECK(length(btrim(event_key))>0), fingerprint char(64) NOT NULL,
      kind varchar(40) NOT NULL CHECK(kind IN ('ORDER_PAID','ORDER_COMPLETED','ORDER_HELD','WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','WITHDRAWAL_PAID','REFUND_RECOGNIZE','REFUND_PAID','AD_PURCHASE','AD_EARN','AD_REFUND')),
      order_id integer REFERENCES order_financial_snapshots(order_id), withdrawal_id uuid REFERENCES merchant_withdrawals(id),
      refund_id uuid REFERENCES finance_refunds(id), advertising_order_id uuid REFERENCES advertising_orders(id),
      creating_xid bigint NOT NULL DEFAULT txid_current(), posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK(num_nonnulls(order_id,withdrawal_id,refund_id,advertising_order_id)=1)
    );
    CREATE INDEX finance_journal_merchant_idx ON financial_transactions(merchant_id,posted_at,id);
    CREATE TABLE financial_postings (
      transaction_id bigint NOT NULL REFERENCES financial_transactions(id), line_no smallint NOT NULL CHECK(line_no>0),
      account_id bigint NOT NULL REFERENCES financial_accounts(id), side char(1) NOT NULL CHECK(side IN ('D','C')),
      amount_satang bigint NOT NULL CHECK(amount_satang>0), PRIMARY KEY(transaction_id,line_no), UNIQUE(transaction_id,account_id)
    );
    CREATE INDEX finance_posting_account_idx ON financial_postings(account_id,transaction_id) INCLUDE(side,amount_satang);
    CREATE FUNCTION finance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'financial_history_immutable' USING ERRCODE='23514'; END $$;
    CREATE FUNCTION finance_posting_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE h financial_transactions; a financial_accounts; BEGIN
      SELECT * INTO h FROM financial_transactions WHERE id=NEW.transaction_id;
      SELECT * INTO a FROM financial_accounts WHERE id=NEW.account_id;
      IF h.creating_xid<>txid_current() OR (a.merchant_id IS NOT NULL AND a.merchant_id<>h.merchant_id) THEN
        RAISE EXCEPTION 'financial_posting_context_invalid' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER finance_posting_insert_guard BEFORE INSERT ON financial_postings FOR EACH ROW EXECUTE FUNCTION finance_posting_insert_guard();
    CREATE FUNCTION finance_balanced_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE tid bigint; mid integer; net numeric; cnt integer; BEGIN
      IF TG_TABLE_NAME='financial_transactions' THEN tid:=NEW.id; ELSE tid:=NEW.transaction_id; END IF;
      SELECT merchant_id INTO mid FROM financial_transactions WHERE id=tid;
      SELECT count(*), coalesce(sum(CASE side WHEN 'D' THEN amount_satang ELSE -amount_satang END),0) INTO cnt,net
        FROM financial_postings WHERE transaction_id=tid;
      IF cnt<2 OR net<>0 THEN RAISE EXCEPTION 'financial_journal_unbalanced' USING ERRCODE='23514'; END IF;
      IF EXISTS(SELECT a.id FROM financial_accounts a JOIN financial_postings p ON p.account_id=a.id
        WHERE a.merchant_id=mid GROUP BY a.id,a.kind
        HAVING sum(CASE WHEN (a.kind='MERCHANT_DEBT' AND p.side='D') OR (a.kind<>'MERCHANT_DEBT' AND p.side='C') THEN p.amount_satang ELSE -p.amount_satang END)<0)
        THEN RAISE EXCEPTION 'financial_balance_negative' USING ERRCODE='23514'; END IF;
      RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER finance_balanced_guard AFTER INSERT ON financial_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_balanced_guard();
    CREATE CONSTRAINT TRIGGER finance_balanced_guard AFTER INSERT ON financial_postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_balanced_guard();
    CREATE FUNCTION finance_route_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE route uuid; BEGIN
      IF TG_TABLE_NAME='orders' THEN
        IF TG_OP='UPDATE' AND (NEW.collection_mode<>OLD.collection_mode OR NEW.payment_recipient_version_id IS DISTINCT FROM OLD.payment_recipient_version_id) THEN
          RAISE EXCEPTION 'finance_route_immutable' USING ERRCODE='23514'; END IF;
        IF TG_OP='UPDATE' AND OLD.collection_mode='PLATFORM' AND
          (to_jsonb(NEW)-ARRAY['status','payment_status','assigned_rider_id','accepted_at','completed_at','cancelled_at','delivering_at','updated_at']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['status','payment_status','assigned_rider_id','accepted_at','completed_at','cancelled_at','delivering_at','updated_at']) THEN
          RAISE EXCEPTION 'finance_order_snapshot_immutable' USING ERRCODE='23514'; END IF;
      ELSE
        SELECT payment_recipient_version_id INTO route FROM orders WHERE id=NEW.order_id;
        IF NEW.payment_recipient_version_id IS DISTINCT FROM route THEN RAISE EXCEPTION 'finance_recipient_mismatch' USING ERRCODE='23514'; END IF;
        IF TG_OP='UPDATE' AND OLD.payment_recipient_version_id IS NOT NULL AND OLD.status='PAID' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'finance_payment_immutable' USING ERRCODE='23514'; END IF;
      END IF; RETURN NEW; END $$;
    CREATE TRIGGER finance_route_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION finance_route_guard();
    CREATE TRIGGER finance_route_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION finance_route_guard();
    CREATE FUNCTION finance_business_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'financial_history_immutable' USING ERRCODE='23514'; END IF;
      IF TG_TABLE_NAME='merchant_withdrawals' THEN
        IF (to_jsonb(NEW)-ARRAY['status','account_review_required','reviewed_by_admin_id','reviewed_at','paid_by_admin_id','paid_at','reason']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','account_review_required','reviewed_by_admin_id','reviewed_at','paid_by_admin_id','paid_at','reason']) THEN
          RAISE EXCEPTION 'withdrawal_snapshot_immutable' USING ERRCODE='23514'; END IF;
        IF OLD.status IN ('PAID','REJECTED','FAILED','CANCELLED') OR (NEW.status<>OLD.status AND NOT
          ((OLD.status='REQUESTED' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED')) OR
           (OLD.status='APPROVED' AND NEW.status IN ('PROCESSING','REJECTED','CANCELLED')) OR
           (OLD.status='PROCESSING' AND NEW.status IN ('PAID','FAILED')))) THEN
          RAISE EXCEPTION 'invalid_withdrawal_transition' USING ERRCODE='23514'; END IF;
      ELSIF TG_TABLE_NAME='finance_transfers' THEN
        IF OLD.status IN ('CONFIRMED','FAILED') OR (to_jsonb(NEW)-ARRAY['status','external_reference','evidence_object_key','confirmed_by_admin_id','confirmed_at']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','external_reference','evidence_object_key','confirmed_by_admin_id','confirmed_at']) THEN
          RAISE EXCEPTION 'transfer_snapshot_immutable' USING ERRCODE='23514'; END IF;
      ELSIF TG_TABLE_NAME='finance_refunds' THEN
        IF OLD.status='PAID' OR (to_jsonb(NEW)-ARRAY['status','paid_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','paid_at']) THEN
          RAISE EXCEPTION 'refund_snapshot_immutable' USING ERRCODE='23514'; END IF;
        IF NEW.status<>OLD.status AND NOT ((OLD.status='APPROVED' AND NEW.status='PROCESSING') OR (OLD.status='PROCESSING' AND NEW.status='PAID')) THEN
          RAISE EXCEPTION 'invalid_refund_transition' USING ERRCODE='23514'; END IF;
      ELSIF TG_TABLE_NAME='merchant_payout_accounts' THEN
        IF (to_jsonb(NEW)-ARRAY['status','is_current','verified_by_admin_id','verified_at']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','is_current','verified_by_admin_id','verified_at']) THEN
          RAISE EXCEPTION 'payout_account_immutable' USING ERRCODE='23514'; END IF;
      END IF; RETURN NEW; END $$;
  `);
  await knex.raw(`
    CREATE FUNCTION finance_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_mid integer; source_id text; expected_prefix text; r finance_refunds; s order_financial_snapshots;
    BEGIN
      IF NEW.order_id IS NOT NULL THEN
        SELECT merchant_id INTO source_mid FROM order_financial_snapshots WHERE order_id=NEW.order_id;
        source_id:=NEW.order_id::text;
        IF NEW.kind NOT IN ('ORDER_PAID','ORDER_COMPLETED','ORDER_HELD') THEN RAISE EXCEPTION 'invalid_finance_source' USING ERRCODE='23514'; END IF;
      ELSIF NEW.withdrawal_id IS NOT NULL THEN
        SELECT merchant_id INTO source_mid FROM merchant_withdrawals WHERE id=NEW.withdrawal_id;
        source_id:=NEW.withdrawal_id::text;
        IF NEW.kind NOT IN ('WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','WITHDRAWAL_PAID') THEN RAISE EXCEPTION 'invalid_finance_source' USING ERRCODE='23514'; END IF;
      ELSIF NEW.refund_id IS NOT NULL THEN
        SELECT * INTO r FROM finance_refunds WHERE id=NEW.refund_id;
        source_mid:=r.merchant_id; source_id:=r.id::text;
        IF NEW.kind NOT IN ('REFUND_RECOGNIZE','REFUND_PAID') THEN RAISE EXCEPTION 'invalid_finance_source' USING ERRCODE='23514'; END IF;
      ELSE
        SELECT merchant_id INTO source_mid FROM advertising_orders WHERE id=NEW.advertising_order_id;
        source_id:=NEW.advertising_order_id::text;
        IF NEW.kind NOT IN ('AD_PURCHASE','AD_EARN','AD_REFUND') THEN RAISE EXCEPTION 'invalid_finance_source' USING ERRCODE='23514'; END IF;
      END IF;
      expected_prefix:=NEW.kind||':'||source_id;
      IF source_mid IS DISTINCT FROM NEW.merchant_id OR NEW.event_key<>expected_prefix OR NEW.creating_xid<>txid_current() THEN
        RAISE EXCEPTION 'invalid_finance_source' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER finance_source_guard BEFORE INSERT ON financial_transactions FOR EACH ROW EXECUTE FUNCTION finance_source_guard();
    CREATE FUNCTION finance_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE o orders; p payments; BEGIN
      SELECT * INTO o FROM orders WHERE id=NEW.order_id;
      SELECT * INTO p FROM payments WHERE id=NEW.paid_payment_id;
      IF o.collection_mode<>'PLATFORM' OR p.status<>'PAID' OR p.verification_status<>'VERIFIED' OR p.transaction_reference IS NULL
        OR NEW.food_subtotal_satang<>o.subtotal_amount*100 OR NEW.delivery_fee_satang<>o.delivery_fee*100
        OR NEW.customer_paid_satang<>o.total_amount*100 OR NEW.customer_paid_satang<>p.amount_transferred*100
        OR NEW.recipient_version_id IS DISTINCT FROM p.payment_recipient_version_id THEN
        RAISE EXCEPTION 'finance_snapshot_mismatch' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER finance_snapshot_guard BEFORE INSERT ON order_financial_snapshots FOR EACH ROW EXECUTE FUNCTION finance_snapshot_guard();
    CREATE FUNCTION finance_refund_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE s order_financial_snapshots; BEGIN
      PERFORM id FROM merchants WHERE id=NEW.merchant_id FOR UPDATE;
      SELECT * INTO s FROM order_financial_snapshots WHERE order_id=NEW.order_id;
      IF EXISTS(SELECT order_id FROM finance_refunds WHERE order_id=NEW.order_id GROUP BY order_id HAVING
        sum(food_satang)>s.food_subtotal_satang OR sum(delivery_satang)>s.delivery_fee_satang OR
        sum(merchant_food_discount_satang)>s.merchant_food_discount_satang OR sum(platform_food_discount_satang)>s.platform_food_discount_satang OR
        sum(merchant_delivery_discount_satang)>s.merchant_delivery_discount_satang OR sum(platform_delivery_discount_satang)>s.platform_delivery_discount_satang OR
        sum(commission_satang)>s.commission_satang OR sum(merchant_recovery_satang)>s.merchant_entitlement_satang OR sum(customer_refund_satang)>s.customer_paid_satang) THEN
        RAISE EXCEPTION 'refund_exceeds_snapshot' USING ERRCODE='23514'; END IF;
      RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER finance_refund_cap_guard AFTER INSERT ON finance_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_refund_cap_guard();
    CREATE FUNCTION finance_ad_ownership_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM banners WHERE id=NEW.banner_id AND merchant_id=NEW.merchant_id AND scope='MERCHANT') THEN
        RAISE EXCEPTION 'finance_ad_ownership' USING ERRCODE='23514'; END IF;
      IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','activated_at','scheduled_end_at','terminated_at','termination_reason','served_satang','unserved_satang','refunded_satang','forfeited_satang']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['status','activated_at','scheduled_end_at','terminated_at','termination_reason','served_satang','unserved_satang','refunded_satang','forfeited_satang']) THEN
        RAISE EXCEPTION 'finance_ad_snapshot_immutable' USING ERRCODE='23514'; END IF;
      IF TG_OP='UPDATE' AND (OLD.status NOT IN ('PAID_PENDING_REVIEW','ACTIVE') OR
        (OLD.status='ACTIVE' AND NEW.status NOT IN ('ACTIVE','CANCELLED','TERMINATED','EXPIRED'))) THEN
        RAISE EXCEPTION 'invalid_ad_transition' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$;
    CREATE TRIGGER finance_ad_ownership_guard BEFORE INSERT OR UPDATE ON advertising_orders FOR EACH ROW EXECUTE FUNCTION finance_ad_ownership_guard();
    ALTER TABLE finance_transfers ADD CONSTRAINT finance_reference_normalized_ck CHECK
      (external_reference IS NULL OR (external_reference=upper(regexp_replace(external_reference,'[[:space:]]','','g')) AND external_reference ~ '^[A-Z0-9][A-Z0-9_.:/-]{2,159}$'));
    CREATE FUNCTION finance_state_posting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE o orders; w merchant_withdrawals; a advertising_orders; t finance_transfers; r finance_refunds; BEGIN
      IF TG_TABLE_NAME='orders' THEN
        SELECT * INTO o FROM orders WHERE id=NEW.id;
        IF o.collection_mode='PLATFORM' AND o.payment_status='PAID' AND
          (NOT EXISTS(SELECT 1 FROM order_financial_snapshots WHERE order_id=o.id) OR NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='ORDER_PAID:'||o.id::text)) THEN
          RAISE EXCEPTION 'finance_capture_required' USING ERRCODE='23514'; END IF;
        IF o.collection_mode='PLATFORM' AND o.status='COMPLETED' AND EXISTS(
          SELECT 1 FROM order_financial_snapshots s WHERE s.order_id=o.id AND
            (s.merchant_entitlement_satang>coalesce((SELECT sum(merchant_recovery_satang) FROM finance_refunds WHERE order_id=o.id),0)
             OR s.commission_satang>coalesce((SELECT sum(commission_satang) FROM finance_refunds WHERE order_id=o.id),0)))
          AND NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='ORDER_COMPLETED:'||o.id::text) THEN
          RAISE EXCEPTION 'finance_release_required' USING ERRCODE='23514'; END IF;
      ELSIF TG_TABLE_NAME='merchant_withdrawals' THEN
        SELECT * INTO w FROM merchant_withdrawals WHERE id=NEW.id;
        IF NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='WITHDRAWAL_RESERVE:'||w.id::text) OR
          (w.status='PAID' AND NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='WITHDRAWAL_PAID:'||w.id::text)) OR
          (w.status IN ('FAILED','REJECTED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='WITHDRAWAL_RELEASE:'||w.id::text)) THEN
          RAISE EXCEPTION 'finance_withdrawal_posting_required' USING ERRCODE='23514'; END IF;
        IF w.status='PAID' AND NOT EXISTS(SELECT 1 FROM finance_transfers WHERE withdrawal_id=w.id AND status='CONFIRMED' AND amount_satang=w.amount_satang) THEN
          RAISE EXCEPTION 'finance_confirmed_transfer_required' USING ERRCODE='23514'; END IF;
      ELSIF TG_TABLE_NAME='finance_transfers' THEN
        SELECT * INTO t FROM finance_transfers WHERE id=NEW.id;
        IF NOT EXISTS(SELECT 1 FROM platform_payment_recipients WHERE id=t.recipient_version_id AND source_account_key=t.source_account_key) THEN
          RAISE EXCEPTION 'finance_transfer_source_mismatch' USING ERRCODE='23514'; END IF;
        IF t.status='CONFIRMED' AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE id=t.confirmed_by_admin_id AND role='SUPER_ADMIN') THEN
          RAISE EXCEPTION 'finance_owner_required' USING ERRCODE='23514'; END IF;
      ELSIF TG_TABLE_NAME='finance_refunds' THEN
        SELECT * INTO r FROM finance_refunds WHERE id=NEW.id;
        IF (r.merchant_recovery_satang+r.commission_satang+r.subsidy_satang>0 AND NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='REFUND_RECOGNIZE:'||r.id::text)) OR
          (r.status='PAID' AND (NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='REFUND_PAID:'||r.id::text) OR
          NOT EXISTS(SELECT 1 FROM finance_transfers WHERE refund_id=r.id AND status='CONFIRMED' AND amount_satang=r.customer_refund_satang))) THEN
          RAISE EXCEPTION 'finance_refund_posting_required' USING ERRCODE='23514'; END IF;
      ELSE
        IF TG_TABLE_NAME='banners' THEN SELECT * INTO a FROM advertising_orders WHERE banner_id=NEW.id AND status IN ('ACTIVE','PAID_PENDING_REVIEW');
        ELSE SELECT * INTO a FROM advertising_orders WHERE id=NEW.id; END IF;
        IF a.id IS NOT NULL THEN
          IF NOT EXISTS(SELECT 1 FROM financial_transactions WHERE event_key='AD_PURCHASE:'||a.id::text) THEN
            RAISE EXCEPTION 'finance_ad_charge_required' USING ERRCODE='23514'; END IF;
          IF a.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM banners WHERE id=a.banner_id AND merchant_id=a.merchant_id AND status='PUBLISHED' AND starts_at=a.activated_at AND ends_at=a.scheduled_end_at) THEN
            RAISE EXCEPTION 'finance_ad_schedule_mismatch' USING ERRCODE='23514'; END IF;
          IF a.status='PAID_PENDING_REVIEW' AND EXISTS(SELECT 1 FROM banners WHERE id=a.banner_id AND status='PUBLISHED') THEN
            RAISE EXCEPTION 'finance_ad_review_required' USING ERRCODE='23514'; END IF;
        END IF;
      END IF; RETURN NULL; END $$;
  `);
  for (const table of ['orders','merchant_withdrawals','finance_transfers','finance_refunds','advertising_orders','banners']) {
    await knex.raw('CREATE CONSTRAINT TRIGGER finance_state_posting_guard AFTER INSERT OR UPDATE ON ?? DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_state_posting_guard()', [table]);
  }
  for (const table of ['finance_policy_versions','platform_payment_recipients','order_financial_snapshots','financial_accounts','financial_transactions','financial_postings']) {
    await knex.raw('CREATE TRIGGER finance_immutable BEFORE UPDATE OR DELETE ON ?? FOR EACH ROW EXECUTE FUNCTION finance_immutable()', [table]);
  }
  for (const table of ['merchant_payout_accounts','merchant_withdrawals','finance_refunds','finance_transfers','advertising_orders','finance_reconciliation_cases']) {
    await knex.raw('CREATE TRIGGER finance_business_guard BEFORE UPDATE OR DELETE ON ?? FOR EACH ROW EXECUTE FUNCTION finance_business_guard()', [table]);
  }
  await knex('system_settings').insert({ setting_key: 'finance.runtime', setting_value: JSON.stringify({ mode: 'LEGACY_MERCHANT_DIRECT', recipient_version_id: null, policy_version_id: null }), is_public: false });
};
exports.down = async function () { throw new Error('Finance history is permanent: use a reviewed forward migration, never destructive rollback'); };
