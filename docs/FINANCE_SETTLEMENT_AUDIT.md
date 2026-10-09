# Finance / Merchant Settlement — Current-State Audit

วันที่ตรวจ: 2026-10-08 · LOCAL ONLY · READ-ONLY AUDIT
สถานะ: READY FOR OWNER REVIEW; **ไม่ใช่ approval ให้รับเงินจริงหรือ implement**
เอกสารคู่กัน: [Design](FINANCE_SETTLEMENT_DESIGN.md), [Schema proposal](FINANCE_SCHEMA_PROPOSAL.md), [Implementation plan](FINANCE_IMPLEMENTATION_PLAN.md).

## 1. Baseline และวิธีตรวจ

- บันทึก git status และ SHA-256 ของ existing tracked/unignored files ก่อนเริ่ม 278 ไฟล์ไว้ใน session.
  Working tree มี modified/untracked หลาย Phase อยู่แล้ว; ไม่ reset/revert/discard.
  HEAD ณ audit: 5c0a11f; working tree ไม่ใช่ clean deployment revision.
- อ่าน PROJECT_CONTEXT.md, DATABASE_SCHEMA.md, migrations ทุกไฟล์ และ source ที่ระบุด้านล่าง.
- เชื่อมต่อโดยใช้ ignored backend/.env ผ่าน env.cjs; ไม่แสดง credential.
- อ่าน pg_catalog/information_schema ภายใน transaction READ ONLY: columns, types,
  nullability, defaults, PK/FK/UNIQUE/CHECK, indexes, triggers, migration history.
  ไม่อ่าน account values, password hashes, provider secrets หรือ raw slips.
- DB จริง: select_topic_2_local ที่ 127.0.0.1:5432; PostgreSQL 16.15;
  database session timezone GMT; timestamps หลักเป็น timestamptz.
- พบ **36 application tables + 2 Knex metadata tables**; ไม่สมมติจำนวนจาก prompt.
- db:status: 6 completed / 0 pending. db:verify-local: PASS.
- Application-table triggers ที่พบ: 0. ไม่มี DB append-only financial protection ในปัจจุบัน.

| Migration ใน repo และ DB | Batch |
|---|---:|
| 202610020001_initial_schema.cjs | 1 |
| 202610020002_production_hardening.cjs | 2 |
| 202610050003_admin_backoffice.cjs | 3 |
| 202610060004_promotion_checkout.cjs | 4 |
| 202610060005_merchant_opening_hours.cjs | 5 |
| 202610070006_customer_engagement.cjs | 6 |

Application inventory:
`audit_logs`, `banners`, `coupon_redemptions`, `coupons`, `customer_addresses`, `customer_favorite_merchants`, `customer_notifications`, `customers`, `delivery_fees`, `dormitories`, `idempotency_keys`, `line_webhook_events`, `menu_categories`, `menu_items`, `menu_option_choices`, `menu_option_groups`, `merchant_images`, `merchant_opening_hours`, `merchant_staffs`, `merchants`, `notification_outbox`, `order_chat_read_states`, `order_item_choices`, `order_items`, `order_messages`, `orders`, `payment_slips`, `payment_verifications`, `payments`, `platform_admin_sessions`, `platform_admins`, `promotion_redemptions`, `promotions`, `reviews`, `sois`, `system_settings`.

## 2. คำตอบ A–J

| คำถาม | สิ่งที่มีจริง | Gap / ผลต่อโมเดลใหม่ |
|---|---|---|
| A Merchant balance | ไม่มี balance account/table; revenue เป็น aggregate orders | ต้องสร้าง Pending/Available/Reserved/Held ที่ derive จาก ledger |
| B Immutable ledger | ไม่มี; payments เป็น mutable operational records | payments / promotion_redemptions ไม่ใช่ double-entry ledger |
| C Payout / withdrawal | ไม่มี tables, APIs หรือ cooldown | ต้องออกแบบใหม่แบบ additive |
| D Commission snapshot | ไม่มี rate/base/commission/net settlement | ต้องมี versioned policy และ immutable per-order finance allocation |
| E Refund accounting | มี REFUNDED enum; paid REJECTED ให้ refund_required | ไม่มี refund entity, transfer record, reversal ledger หรือ refund worker |
| F Platform recipient config | ไม่มี PLATFORM recipient authority; system_settings ยังเป็น display settings | ต้องเพิ่ม backend-only versioned config; ห้ามใช้ merchant_id=null แทน platform โดยปริยาย |
| G QR recipient | merchants.promptpay_identifier_type + promptpay_id | ต้องเปลี่ยนทั้ง QR, verifier input, exact-account binding และ UI copyใน Phase implementation |
| H Payment contents | attempt/status, expected/actual amount, reference, provider, verified/paid timestamps | ไม่มี custody route, commission, bank reconciliation, payout linkage |
| I Revenue reporting | SUM(order.total_amount) เมื่อ COMPLETED + PAID | รวมค่าส่งและ net discount; ไม่ใช่ GP, merchant payable หรือ bank cash |
| J Discount funding | ไม่มี funding_source; merchant_id ระบุ eligibility scope | global ≠ platform-funded และ merchant-scoped ≠ merchant-funded โดยอัตโนมัติ |

## 3. Current payment flow และ source evidence

[payment-service.cjs](../backend/src/payment-service.cjs):
- ownedOrder joins merchant เพื่อรับ PromptPay ปัจจุบัน.
- createAttempt locks order/latest payment; attempts retry ERROR ได้.
- getQr ใช้ order.total_amount และ merchant PromptPay; ส่ง PNG/payload และ masked identifier.
  QR payload ย่อม encode recipient เพื่อใช้ชำระเงินจริง; ไม่สามารถอ้างว่าซ่อน recipient จาก QR ได้.
- uploadAndVerify: customer ownership, MIME/size <=4 MiB, storage abstraction,
  unique file hash, transaction marking PROCESSING, provider HTTP นอก DB transaction.
- finalize locks order/payment; ตรวจ reference, exact amount, recipient,
  order payable และ duplicate reference; update payments/order + notification outbox ใน transaction.
- DB partial UNIQUE reference และ one PAID payment/order ป้องกันการแข่งขันข้าม requests.
  ยังไม่มี entitlement/ledger insert ใน transaction นี้.
- หาก provider ตอบสำเร็จแต่ process/DB commit ล้ม: ไม่มี durable finance reconciliation
  หรือ bank statement matching; ห้ามตีความ timeout ว่าเงินไม่เข้า.
  frontend/lib/payment-presentation.mjs::paymentNeedsReconciliation เป็น UX polling guard
  สำหรับ PROCESSING/VERIFIED เท่านั้น ไม่ใช่ bank/ledger reconciliation worker.

[easyslip-provider.cjs](../backend/src/payment-verifiers/easyslip-provider.cjs):
- recipientMapping อ่าน EASYSLIP_MERCHANT_ACCOUNTS[String(merchantId)].
- เปรียบเทียบ PromptPay mapping, bank code และ full canonical bank account
  ทั้ง matchedAccount และ raw receiver; masked/partial account ไม่ถือว่า match.
- ส่ง amount และ duplicate checks; result merchantId ต้องตรง order.merchant_id ใน finalize.
- มี rawRedacted allowlist/digest; ห้ามเปลี่ยนเป็นเชื่อ provider success อย่างเดียว.
- โมเดลใหม่ต้องเปลี่ยน binding เป็น recipient_version ของ platform;
  ownership ยังคงมาจาก order.merchant_id ไม่ใช่บัญชีผู้รับใน slip.

[config.cjs](../backend/src/config.cjs), [payment-verifier.cjs](../backend/src/payment-verifier.cjs):
มี mock/checkslip/easyslip modes; production mock guards และ provider credential validation.
ไม่มี current platform payment configuration. ไม่ต้องเปลี่ยน provider HTTP protocol ใน audit นี้.

[merchant-store-management.cjs](../backend/src/merchant-store-management.cjs):
PromptPay master ปัจจุบันยังแก้ได้โดย manager โดยมี guard สำหรับ pending payments.
ไม่ใช่ verified payout account และไม่ encrypted. ห้ามย้ายข้อมูลนี้เป็น verified payout account อัตโนมัติ.

## 4. Accounting/reporting ที่มีจริง

- [merchant-management.cjs](../backend/src/merchant-management.cjs)::dashboard:
  revenue_today/AOV เป็น COMPLETED+PAID; cohort ตาม orders.created_at ในวัน Asia/Bangkok;
  active queue อาจรวมวันก่อน. KITCHEN ไม่ได้รับ revenue/AOV.
- [merchant-report-management.cjs](../backend/src/merchant-report-management.cjs)::reports:
  1/7/30-day creation cohort, net total หลัง discount **รวม delivery**; ranking ใช้ historical items/options.
- [admin-service.cjs](../backend/src/admin-service.cjs)::reports:
  summary.gross ใช้ net total เช่นกัน; today เริ่มจาก server timezone ไม่เหมือน merchant
  Bangkok explicit boundary. จึงไม่ควรใช้ field ชื่อ gross เป็น accounting GMV.
- ไม่มี materialized accounting tables, cashbook, commission receivable, merchant payable,
  reserved withdrawal หรือ accrued advertising revenue.
- order.completed_at และ delivering_at มีอยู่จริง (delivering_at เพิ่มใน migration 002).
- [rider-order-service.cjs](../backend/src/rider-order-service.cjs) เป็น completion hook ปัจจุบัน;
  assigned rider + merchant scoping/locks ต้องคงเดิม. การ assigned rider ไม่ได้บอกว่า rider เป็นเจ้าของค่าส่ง.

## 5. Promotions / coupons

[promotion-service.cjs](../backend/src/promotion-service.cjs),
[coupon-service.cjs](../backend/src/coupon-service.cjs),
[order-service.cjs](../backend/src/order-service.cjs):
- PERCENTAGE/FIXED_AMOUNT ลด food subtotal; FREE_DELIVERY ลด delivery fee; cap/minimum/quota enforced.
- Percentage ใช้ BigInt basis-point multiplication และ half-up. payment-money.cjs parse
  decimal satang แบบ reject fractional satang. order-service ยังมี Math.round(Number(value)*100)
  boundary: finance ใหม่ต้องใช้ strict decimal parser/BigInt ไม่ยืม float path นี้.
- Promotion XOR coupon; snapshots เก็บ display/rule values, discount_satang,
  calculation_version=1 และ ORDER_CREATED_NO_AUTO_RELEASE.
- Redemption เป็นตอน order creation; ไม่คืน quota อัตโนมัติ. ไม่มี funding allocation
  หรือ merchant consent สำหรับ platform campaign ที่อาจหัก merchant.
- merchant_id คือ scope เท่านั้น. ต้องให้ Owner assign funding ชัดเจนก่อน finance cutover;
  ห้าม backfill funding ของ historical orders จาก master ปัจจุบัน.

## 6. Banners: reuse architecture เดิม

- banners มี private image_object_key, scope, merchant_id, target_type/value,
  status DRAFT/SCHEDULED/PUBLISHED/ARCHIVED, starts_at/ends_at, sort_order, soft delete.
- Admin upload/editor: [admin-router.cjs](../backend/src/admin-router.cjs),
  [admin-content-manager.js](../frontend/components/admin-content-manager.js).
- /api/banners/active และ public image endpoint อ่านเฉพาะ PUBLISHED,
  starts_at <= now, ends_at > now (nullable boundaries allowed), sort_order แล้ว id.
- **SCHEDULED ไม่ถูก public query ดึง และไม่มี automatic publisher ที่ตรวจพบ**.
  ใช้ PUBLISHED พร้อม future starts_at โดย Admin approval เป็นแนวทาง reuse ที่ไม่ต้องสร้าง carousel ใหม่.
- Merchant management ปัจจุบัน read-only content listing; ไม่มี merchant advertising billing.
- Home refresh published API ทุกนาที/visibility, carousel ใช้ existing targets.
  Proposed advertising_order เชื่อม banner เดิม; scope MERCHANT ยังปรากฏใน public active list ได้.
- ยังไม่มีราคา 300/30 วัน, purchase consent, ad fee, refund หรือ earned/unearned ad revenue.

## 7. Security และ components ที่ reuse ได้

| Component | Reuse | ข้อจำกัดที่ต้องออกแบบเพิ่ม |
|---|---|---|
| merchant_staffs + staff-auth | role/tenant identity, bcrypt, HttpOnly Secure production SameSite=Lax | session/attempt Map ใน memory; ไม่มี dedicated finance re-auth; restart logout ไม่ใช่ durable authorization proof |
| platform_admins/sessions | SUPER_ADMIN/ADMIN/SUPPORT/FINANCE, durable session, CSRF | FINANCE ปัจจุบันมี read payments/reports; ไม่มี payout-write permission. ต้องอนุมัติ permission ใหม่ ไม่ขยาย role เดิมเงียบ ๆ |
| request origin policy | app.cjs ปฏิเสธ supplied cross-origin | absent Origin ยังผ่าน; finance mutations ต้องมี explicit CSRF และ recent re-auth |
| audit_logs | action/actor/request metadata ใน transaction | เป็น append convention ไม่ใช่ DB immutable; redactor ไม่ครอบคลุม bankNumber/account_name จึงต้องเพิ่ม allowlist สำหรับ finance |
| idempotency_keys | scope+key+fingerprint, durable response, expiry | expiry ทำให้ไม่เหมาะเป็นตัวกัน duplicate financial posting ระยะยาว; ledger permanent source key จำเป็น |
| notification_outbox | transaction enqueue + retry/skipLocked | order_id NOT NULL + ON DELETE CASCADE; current builder ส่ง customer order events เท่านั้น ไม่รองรับ withdrawal โดยตรง |
| private S3/local storage | opaque keys, put/read/remove/head และ retention patterns | payout proof ต้องแยก namespace/retention; ห้ามใช้ slip purge_after ระยะสั้นกับหลักฐานทางการเงิน |
| system_settings | JSONB unique setting_key, admin audit | current whitelist ไม่มี finance; plaintext JSONB และ settings() select * ไม่ใช่ secret store |

ไม่พบ managed encryption/KMS/Vault integration สำหรับ payout identifiers.
bcrypt ใช้ hash password ไม่สามารถนำมาเป็น encryption ของบัญชีที่จะโอนได้.
ไม่มี bank payout provider/auto settlement; ไม่ควร reuse LINE notification worker เพื่อโอนเงิน.

## 8. Risk / migration gaps

1. การเปลี่ยน QR เป็น platform โดยไม่ ledger/cutover gate จะรับเงินแล้วไม่รู้หนี้ร้าน.
2. Existing direct-to-merchant PAID records ต้องไม่สร้าง platform cash หรือ payable ย้อนหลัง.
3. Funding + delivery ownership + GP recognition/rounding ต้อง Owner sign-off.
4. paid rejection มีเพียง manual-refund flag; ไม่มี durable refund reservation/decision.
5. Reporting ณ created_at ไม่เท่ากับ cash/earned/paid-out period.
6. Payout external success แต่ DB timeout ห้าม mark FAILED และ release เงินทันที.
7. Old payout account ต้อง pin เป็น immutable version; master changes ห้าม redirect transfer.
8. Ledger needs DB enforcement + reconciliation; application convention อย่างเดียวไม่พอ.
9. Current payment partial uniqueness เฉพาะ status=PAID: future refund ห้ามเปิดทาง charge
   order เดิมใหม่เมื่อ PAID ถูกเปลี่ยนเป็น REFUNDED; finance snapshot paid_payment_id ต้องคงถาวร.
10. อัตรา 5% และราคา 300/30 วันเป็น business requirement; ยังไม่มี VAT/tax/bank-fee
    treatment ที่ Owner กำหนด. ตัวอย่างเป็น operational allocation ไม่ใช่งบการเงินตามกฎหมาย.

## 9. Validation scope

- db:status PASS; db:verify-local PASS; catalog evidence below.
- Docs only; application tests ไม่ rerun ตามขอบเขตผู้ใช้.
- Final existing-file SHA-256 comparison PASS: ไม่มี existing file เปลี่ยน; เพิ่มเฉพาะ docs 4 ไฟล์.
- Re-read actual schema/history/columns/constraints/indexes หลังเขียน docs: เท่ากับ baseline.
- Markdown local references 24 links PASS; accounting examples/journal arithmetic PASS.
- git diff --check PASS; secret scan PASS (284 tracked/unignored files, zero findings).
- **APPLICATION CODE CHANGED = NO; MIGRATION NOT CREATED.**

## Appendix: catalog evidence (metadata only)

ตารางด้านล่างมาจาก DB จริง; ? หมายถึง nullable. Existing entity IDs ส่วนใหญ่เป็น
integer ไม่ใช่ bigint; proposed FK ต้องใช้ type ให้ตรง parent.

### merchants

Columns: `id integer NOT NULL`; `store_name character varying NOT NULL`; `phone character varying NOT NULL`; `location_text text NOT NULL`; `promptpay_identifier_type character varying NOT NULL`; `promptpay_id character varying NOT NULL`; `prefix character varying NOT NULL`; `last_order_number integer NOT NULL`; `is_open boolean NOT NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`; `is_active boolean NOT NULL`; `suspended_at timestamp with time zone NULL`; `suspension_reason character varying NULL`; `suspended_by_admin_id integer NULL`.

Constraints:

- `merchants_order_counter_check`: `CHECK ((last_order_number >= 0))`
- `merchants_pkey`: `PRIMARY KEY (id)`
- `merchants_prefix_unique`: `UNIQUE (prefix)`
- `merchants_promptpay_type_check`: `CHECK (((promptpay_identifier_type)::text = ANY ((ARRAY['PHONE'::character varying, 'NATIONAL_ID'::character varying, 'TAX_ID'::character varying, 'EWALLET'::character varying])::text[])))`
- `merchants_suspended_by_admin_id_foreign`: `FOREIGN KEY (suspended_by_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL`

Indexes (including constraint-backed indexes):

- `CREATE INDEX merchants_is_active_is_open_index ON public.merchants USING btree (is_active, is_open)`
- `CREATE UNIQUE INDEX merchants_pkey ON public.merchants USING btree (id)`
- `CREATE UNIQUE INDEX merchants_prefix_unique ON public.merchants USING btree (prefix)`

### merchant_staffs

Columns: `id integer NOT NULL`; `merchant_id integer NOT NULL`; `username character varying NOT NULL`; `password_hash character varying NOT NULL`; `full_name character varying NOT NULL`; `phone character varying NULL`; `line_user_id character varying NULL`; `role character varying NOT NULL`; `is_active boolean NOT NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`.

Constraints:

- `merchant_staffs_id_merchant_id_unique`: `UNIQUE (id, merchant_id)`
- `merchant_staffs_line_user_id_unique`: `UNIQUE (line_user_id)`
- `merchant_staffs_merchant_id_foreign`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `merchant_staffs_pkey`: `PRIMARY KEY (id)`
- `merchant_staffs_role_check`: `CHECK (((role)::text = ANY ((ARRAY['MANAGER'::character varying, 'CASHIER'::character varying, 'KITCHEN'::character varying, 'RIDER'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX merchant_staffs_active_username ON public.merchant_staffs USING btree (merchant_id, username) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX merchant_staffs_active_username_global ON public.merchant_staffs USING btree (lower((username)::text)) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX merchant_staffs_id_merchant_id_unique ON public.merchant_staffs USING btree (id, merchant_id)`
- `CREATE UNIQUE INDEX merchant_staffs_line_user_id_unique ON public.merchant_staffs USING btree (line_user_id)`
- `CREATE INDEX merchant_staffs_merchant_id_role_is_active_index ON public.merchant_staffs USING btree (merchant_id, role, is_active)`
- `CREATE UNIQUE INDEX merchant_staffs_pkey ON public.merchant_staffs USING btree (id)`

### orders

Columns: `id integer NOT NULL`; `order_code character varying NOT NULL`; `merchant_order_number integer NOT NULL`; `customer_id integer NOT NULL`; `merchant_id integer NOT NULL`; `customer_address_id integer NULL`; `assigned_rider_id integer NULL`; `delivery_type character varying NOT NULL`; `status character varying NOT NULL`; `payment_method character varying NOT NULL`; `payment_status character varying NOT NULL`; `subtotal_amount numeric NOT NULL`; `delivery_fee numeric NOT NULL`; `total_amount numeric NOT NULL`; `delivery_address_label character varying NULL`; `delivery_soi_name character varying NULL`; `delivery_dormitory_name character varying NULL`; `delivery_location_text text NULL`; `delivery_room_number character varying NULL`; `delivery_contact_phone character varying NULL`; `delivery_note text NULL`; `accepted_at timestamp with time zone NULL`; `completed_at timestamp with time zone NULL`; `cancelled_at timestamp with time zone NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `delivering_at timestamp with time zone NULL`; `promotion_id integer NULL`; `promotion_snapshot jsonb NULL`; `discount_amount numeric NOT NULL`; `coupon_id integer NULL`; `coupon_snapshot jsonb NULL`.

Constraints:

- `orders_amounts_check`: `CHECK (((subtotal_amount >= (0)::numeric) AND (delivery_fee >= (0)::numeric) AND (discount_amount >= (0)::numeric) AND (discount_amount <= (subtotal_amount + delivery_fee)) AND (total_amount >= (0)::numeric) AND (total_amount = ((subtotal_amount + delivery_fee) - discount_amount))))`
- `orders_assigned_rider_id_merchant_id_foreign`: `FOREIGN KEY (assigned_rider_id, merchant_id) REFERENCES merchant_staffs(id, merchant_id)`
- `orders_coupon_id_foreign`: `FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE RESTRICT`
- `orders_customer_address_id_customer_id_foreign`: `FOREIGN KEY (customer_address_id, customer_id) REFERENCES customer_addresses(id, customer_id)`
- `orders_customer_id_foreign`: `FOREIGN KEY (customer_id) REFERENCES customers(id)`
- `orders_delivery_snapshot_check`: `CHECK (((((delivery_type)::text = 'DELIVERY'::text) AND (customer_address_id IS NOT NULL) AND (delivery_address_label IS NOT NULL) AND (delivery_soi_name IS NOT NULL) AND (delivery_dormitory_name IS NOT NULL) AND (delivery_location_text IS NOT NULL) AND (delivery_room_number IS NOT NULL) AND (delivery_contact_phone IS NOT NULL)) OR (((delivery_type)::text = 'PICKUP'::text) AND (customer_address_id IS NULL) AND (delivery_fee = (0)::numeric) AND (delivery_address_label IS NULL) AND (delivery_soi_name IS NULL) AND (delivery_dormitory_name IS NULL) AND (delivery_location_text IS NULL) AND (delivery_room_number IS NULL) AND (delivery_contact_phone IS NULL))))`
- `orders_delivery_type_check`: `CHECK (((delivery_type)::text = ANY ((ARRAY['DELIVERY'::character varying, 'PICKUP'::character varying])::text[])))`
- `orders_discount_source_check`: `CHECK ((((promotion_id IS NULL) AND (promotion_snapshot IS NULL) AND (coupon_id IS NULL) AND (coupon_snapshot IS NULL) AND (discount_amount = (0)::numeric)) OR ((promotion_id IS NOT NULL) AND (promotion_snapshot IS NOT NULL) AND (jsonb_typeof(promotion_snapshot) = 'object'::text) AND (coupon_id IS NULL) AND (coupon_snapshot IS NULL)) OR ((coupon_id IS NOT NULL) AND (coupon_snapshot IS NOT NULL) AND (jsonb_typeof(coupon_snapshot) = 'object'::text) AND (promotion_id IS NULL) AND (promotion_snapshot IS NULL))))`
- `orders_id_merchant_id_unique`: `UNIQUE (id, merchant_id)`
- `orders_merchant_id_foreign`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id)`
- `orders_merchant_id_merchant_order_number_unique`: `UNIQUE (merchant_id, merchant_order_number)`
- `orders_order_code_unique`: `UNIQUE (order_code)`
- `orders_payment_method_check`: `CHECK (((payment_method)::text = ANY ((ARRAY['PROMPTPAY'::character varying, 'COD'::character varying])::text[])))`
- `orders_payment_status_check`: `CHECK (((payment_status)::text = ANY ((ARRAY['UNPAID'::character varying, 'PENDING_VERIFICATION'::character varying, 'PAID'::character varying, 'FAILED'::character varying, 'REFUNDED'::character varying, 'CANCELLED'::character varying])::text[])))`
- `orders_pkey`: `PRIMARY KEY (id)`
- `orders_promotion_id_foreign`: `FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT`
- `orders_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'PREPARING'::character varying, 'READY'::character varying, 'DELIVERING'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying, 'REJECTED'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX orders_coupon_id_index ON public.orders USING btree (coupon_id)`
- `CREATE INDEX orders_created_at_index ON public.orders USING btree (created_at)`
- `CREATE INDEX orders_customer_id_created_at_index ON public.orders USING btree (customer_id, created_at)`
- `CREATE UNIQUE INDEX orders_id_merchant_id_unique ON public.orders USING btree (id, merchant_id)`
- `CREATE INDEX orders_merchant_id_assigned_rider_id_status_index ON public.orders USING btree (merchant_id, assigned_rider_id, status)`
- `CREATE UNIQUE INDEX orders_merchant_id_merchant_order_number_unique ON public.orders USING btree (merchant_id, merchant_order_number)`
- `CREATE INDEX orders_merchant_id_payment_status_created_at_index ON public.orders USING btree (merchant_id, payment_status, created_at)`
- `CREATE INDEX orders_merchant_id_status_created_at_index ON public.orders USING btree (merchant_id, status, created_at)`
- `CREATE UNIQUE INDEX orders_order_code_unique ON public.orders USING btree (order_code)`
- `CREATE INDEX orders_payment_status_created_at_index ON public.orders USING btree (payment_status, created_at)`
- `CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)`
- `CREATE INDEX orders_promotion_id_index ON public.orders USING btree (promotion_id)`
- `CREATE INDEX orders_status_created_at_index ON public.orders USING btree (status, created_at)`

### order_items

Columns: `id integer NOT NULL`; `order_id integer NOT NULL`; `merchant_id integer NOT NULL`; `menu_item_id integer NULL`; `item_name character varying NOT NULL`; `quantity integer NOT NULL`; `unit_price numeric NOT NULL`; `note text NULL`; `is_completed boolean NOT NULL`.

Constraints:

- `order_items_menu_item_id_merchant_id_foreign`: `FOREIGN KEY (menu_item_id, merchant_id) REFERENCES menu_items(id, merchant_id)`
- `order_items_order_id_merchant_id_foreign`: `FOREIGN KEY (order_id, merchant_id) REFERENCES orders(id, merchant_id)`
- `order_items_pkey`: `PRIMARY KEY (id)`
- `order_items_values_check`: `CHECK (((quantity > 0) AND (unit_price >= (0)::numeric)))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX order_items_menu_item_id_index ON public.order_items USING btree (menu_item_id)`
- `CREATE INDEX order_items_order_id_index ON public.order_items USING btree (order_id)`
- `CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (id)`

### order_item_choices

Columns: `id integer NOT NULL`; `order_item_id integer NOT NULL`; `menu_option_choice_id integer NULL`; `choice_name character varying NOT NULL`; `extra_price numeric NOT NULL`.

Constraints:

- `order_item_choices_menu_option_choice_id_foreign`: `FOREIGN KEY (menu_option_choice_id) REFERENCES menu_option_choices(id)`
- `order_item_choices_order_item_id_foreign`: `FOREIGN KEY (order_item_id) REFERENCES order_items(id)`
- `order_item_choices_pkey`: `PRIMARY KEY (id)`
- `order_item_choices_price_check`: `CHECK ((extra_price >= (0)::numeric))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX order_item_choices_menu_option_choice_id_index ON public.order_item_choices USING btree (menu_option_choice_id)`
- `CREATE INDEX order_item_choices_order_item_id_index ON public.order_item_choices USING btree (order_item_id)`
- `CREATE UNIQUE INDEX order_item_choices_pkey ON public.order_item_choices USING btree (id)`

### payments

Columns: `id integer NOT NULL`; `order_id integer NOT NULL`; `method character varying NOT NULL`; `status character varying NOT NULL`; `verification_status character varying NOT NULL`; `expected_amount numeric NOT NULL`; `amount_transferred numeric NULL`; `provider character varying NULL`; `transaction_reference character varying NULL`; `verified_at timestamp with time zone NULL`; `paid_at timestamp with time zone NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`.

Constraints:

- `payments_amounts_check`: `CHECK (((expected_amount >= (0)::numeric) AND ((amount_transferred IS NULL) OR (amount_transferred >= (0)::numeric))))`
- `payments_method_check`: `CHECK (((method)::text = ANY ((ARRAY['PROMPTPAY'::character varying, 'COD'::character varying])::text[])))`
- `payments_method_verification_check`: `CHECK (((((method)::text = 'COD'::text) AND ((verification_status)::text = 'NOT_REQUIRED'::text)) OR ((method)::text = 'PROMPTPAY'::text)))`
- `payments_order_id_foreign`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `payments_pkey`: `PRIMARY KEY (id)`
- `payments_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'SUBMITTED'::character varying, 'PROCESSING'::character varying, 'PAID'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying, 'REFUNDED'::character varying])::text[])))`
- `payments_verification_status_check`: `CHECK (((verification_status)::text = ANY ((ARRAY['NOT_REQUIRED'::character varying, 'PENDING'::character varying, 'PROCESSING'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying, 'ERROR'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX payments_one_paid_per_order ON public.payments USING btree (order_id) WHERE ((status)::text = 'PAID'::text)`
- `CREATE INDEX payments_order_id_created_at_index ON public.payments USING btree (order_id, created_at)`
- `CREATE INDEX payments_order_id_status_index ON public.payments USING btree (order_id, status)`
- `CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id)`
- `CREATE INDEX payments_status_created_at_index ON public.payments USING btree (status, created_at)`
- `CREATE UNIQUE INDEX payments_transaction_reference_unique ON public.payments USING btree (transaction_reference) WHERE (transaction_reference IS NOT NULL)`
- `CREATE INDEX payments_verification_created_at_index ON public.payments USING btree (verification_status, created_at)`

### payment_slips

Columns: `id integer NOT NULL`; `payment_id integer NOT NULL`; `object_key character varying NOT NULL`; `file_hash character varying NOT NULL`; `uploaded_at timestamp with time zone NOT NULL`; `purge_after timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`.

Constraints:

- `payment_slips_file_hash_unique`: `UNIQUE (file_hash)`
- `payment_slips_payment_id_foreign`: `FOREIGN KEY (payment_id) REFERENCES payments(id)`
- `payment_slips_payment_id_unique`: `UNIQUE (payment_id)`
- `payment_slips_pkey`: `PRIMARY KEY (id)`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX payment_slips_file_hash_unique ON public.payment_slips USING btree (file_hash)`
- `CREATE UNIQUE INDEX payment_slips_payment_id_unique ON public.payment_slips USING btree (payment_id)`
- `CREATE UNIQUE INDEX payment_slips_pkey ON public.payment_slips USING btree (id)`
- `CREATE INDEX payment_slips_purge_after_deleted_at_index ON public.payment_slips USING btree (purge_after, deleted_at)`

### payment_verifications

Columns: `id integer NOT NULL`; `payment_id integer NOT NULL`; `provider character varying NOT NULL`; `provider_request_id character varying NULL`; `status character varying NOT NULL`; `failure_code character varying NULL`; `provider_transaction_reference character varying NULL`; `reported_amount numeric NULL`; `amount_matches boolean NULL`; `recipient_matches boolean NULL`; `provider_response jsonb NOT NULL`; `verified_at timestamp with time zone NULL`; `response_purge_after timestamp with time zone NULL`; `created_at timestamp with time zone NOT NULL`.

Constraints:

- `payment_verifications_amount_check`: `CHECK (((reported_amount IS NULL) OR (reported_amount >= (0)::numeric)))`
- `payment_verifications_payment_id_foreign`: `FOREIGN KEY (payment_id) REFERENCES payments(id)`
- `payment_verifications_pkey`: `PRIMARY KEY (id)`
- `payment_verifications_provider_provider_request_id_unique`: `UNIQUE (provider, provider_request_id)`
- `payment_verifications_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'VERIFIED'::character varying, 'REJECTED'::character varying, 'ERROR'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX payment_verifications_payment_id_created_at_index ON public.payment_verifications USING btree (payment_id, created_at)`
- `CREATE UNIQUE INDEX payment_verifications_pkey ON public.payment_verifications USING btree (id)`
- `CREATE UNIQUE INDEX payment_verifications_provider_provider_request_id_unique ON public.payment_verifications USING btree (provider, provider_request_id)`

### promotions

Columns: `id integer NOT NULL`; `name character varying NOT NULL`; `description text NULL`; `merchant_id integer NULL`; `promotion_type character varying NOT NULL`; `value numeric NOT NULL`; `minimum_order_amount numeric NOT NULL`; `maximum_discount_amount numeric NULL`; `starts_at timestamp with time zone NOT NULL`; `ends_at timestamp with time zone NOT NULL`; `usage_limit integer NULL`; `usage_count integer NOT NULL`; `is_active boolean NOT NULL`; `created_by_admin_id integer NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`.

Constraints:

- `promotions_created_by_admin_id_foreign`: `FOREIGN KEY (created_by_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL`
- `promotions_date_range_check`: `CHECK ((ends_at > starts_at))`
- `promotions_maximum_check`: `CHECK (((maximum_discount_amount IS NULL) OR (maximum_discount_amount >= (0)::numeric)))`
- `promotions_merchant_id_foreign`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT`
- `promotions_minimum_check`: `CHECK ((minimum_order_amount >= (0)::numeric))`
- `promotions_percentage_check`: `CHECK ((((promotion_type)::text <> 'PERCENTAGE'::text) OR (value <= (100)::numeric)))`
- `promotions_pkey`: `PRIMARY KEY (id)`
- `promotions_type_check`: `CHECK (((promotion_type)::text = ANY ((ARRAY['PERCENTAGE'::character varying, 'FIXED_AMOUNT'::character varying, 'FREE_DELIVERY'::character varying])::text[])))`
- `promotions_usage_count_check`: `CHECK ((usage_count >= 0))`
- `promotions_usage_limit_check`: `CHECK (((usage_limit IS NULL) OR (usage_limit > 0)))`
- `promotions_value_check`: `CHECK ((value >= (0)::numeric))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX promotions_is_active_starts_at_ends_at_index ON public.promotions USING btree (is_active, starts_at, ends_at)`
- `CREATE INDEX promotions_merchant_id_is_active_index ON public.promotions USING btree (merchant_id, is_active)`
- `CREATE UNIQUE INDEX promotions_pkey ON public.promotions USING btree (id)`

### promotion_redemptions

Columns: `id integer NOT NULL`; `promotion_id integer NOT NULL`; `order_id integer NOT NULL`; `customer_id integer NOT NULL`; `discount_amount numeric NOT NULL`; `created_at timestamp with time zone NOT NULL`.

Constraints:

- `promotion_redemptions_customer_id_foreign`: `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT`
- `promotion_redemptions_discount_check`: `CHECK ((discount_amount >= (0)::numeric))`
- `promotion_redemptions_order_id_foreign`: `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT`
- `promotion_redemptions_order_id_unique`: `UNIQUE (order_id)`
- `promotion_redemptions_pkey`: `PRIMARY KEY (id)`
- `promotion_redemptions_promotion_id_foreign`: `FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE RESTRICT`

Indexes (including constraint-backed indexes):

- `CREATE INDEX promotion_redemptions_customer_id_created_at_index ON public.promotion_redemptions USING btree (customer_id, created_at)`
- `CREATE UNIQUE INDEX promotion_redemptions_order_id_unique ON public.promotion_redemptions USING btree (order_id)`
- `CREATE UNIQUE INDEX promotion_redemptions_pkey ON public.promotion_redemptions USING btree (id)`
- `CREATE INDEX promotion_redemptions_promotion_id_created_at_index ON public.promotion_redemptions USING btree (promotion_id, created_at)`

### coupons

Columns: `id integer NOT NULL`; `code character varying NOT NULL`; `name character varying NOT NULL`; `description text NULL`; `merchant_id integer NULL`; `promotion_type character varying NOT NULL`; `value numeric NOT NULL`; `minimum_order_amount numeric NOT NULL`; `maximum_discount_amount numeric NULL`; `starts_at timestamp with time zone NOT NULL`; `ends_at timestamp with time zone NOT NULL`; `usage_limit integer NULL`; `per_customer_limit integer NULL`; `usage_count integer NOT NULL`; `is_active boolean NOT NULL`; `created_by_admin_id integer NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`.

Constraints:

- `coupons_created_by_admin_id_foreign`: `FOREIGN KEY (created_by_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL`
- `coupons_customer_limit_check`: `CHECK (((per_customer_limit IS NULL) OR (per_customer_limit > 0)))`
- `coupons_date_range_check`: `CHECK ((ends_at > starts_at))`
- `coupons_maximum_check`: `CHECK (((maximum_discount_amount IS NULL) OR (maximum_discount_amount >= (0)::numeric)))`
- `coupons_merchant_id_foreign`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT`
- `coupons_minimum_check`: `CHECK ((minimum_order_amount >= (0)::numeric))`
- `coupons_percentage_check`: `CHECK ((((promotion_type)::text <> 'PERCENTAGE'::text) OR (value <= (100)::numeric)))`
- `coupons_pkey`: `PRIMARY KEY (id)`
- `coupons_type_check`: `CHECK (((promotion_type)::text = ANY ((ARRAY['PERCENTAGE'::character varying, 'FIXED_AMOUNT'::character varying, 'FREE_DELIVERY'::character varying])::text[])))`
- `coupons_usage_count_check`: `CHECK ((usage_count >= 0))`
- `coupons_usage_limit_check`: `CHECK (((usage_limit IS NULL) OR (usage_limit > 0)))`
- `coupons_value_check`: `CHECK ((value >= (0)::numeric))`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX coupons_active_code_unique ON public.coupons USING btree (lower((code)::text)) WHERE (deleted_at IS NULL)`
- `CREATE INDEX coupons_is_active_starts_at_ends_at_index ON public.coupons USING btree (is_active, starts_at, ends_at)`
- `CREATE INDEX coupons_merchant_id_is_active_index ON public.coupons USING btree (merchant_id, is_active)`
- `CREATE UNIQUE INDEX coupons_pkey ON public.coupons USING btree (id)`

### coupon_redemptions

Columns: `id integer NOT NULL`; `coupon_id integer NOT NULL`; `customer_id integer NOT NULL`; `order_id integer NOT NULL`; `discount_amount numeric NOT NULL`; `created_at timestamp with time zone NOT NULL`.

Constraints:

- `coupon_redemptions_coupon_id_foreign`: `FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE RESTRICT`
- `coupon_redemptions_customer_id_foreign`: `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT`
- `coupon_redemptions_discount_check`: `CHECK ((discount_amount >= (0)::numeric))`
- `coupon_redemptions_order_id_foreign`: `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT`
- `coupon_redemptions_order_id_unique`: `UNIQUE (order_id)`
- `coupon_redemptions_pkey`: `PRIMARY KEY (id)`

Indexes (including constraint-backed indexes):

- `CREATE INDEX coupon_redemptions_coupon_id_created_at_index ON public.coupon_redemptions USING btree (coupon_id, created_at)`
- `CREATE INDEX coupon_redemptions_coupon_id_customer_id_index ON public.coupon_redemptions USING btree (coupon_id, customer_id)`
- `CREATE INDEX coupon_redemptions_customer_id_created_at_index ON public.coupon_redemptions USING btree (customer_id, created_at)`
- `CREATE UNIQUE INDEX coupon_redemptions_order_id_unique ON public.coupon_redemptions USING btree (order_id)`
- `CREATE UNIQUE INDEX coupon_redemptions_pkey ON public.coupon_redemptions USING btree (id)`

### banners

Columns: `id integer NOT NULL`; `title character varying NOT NULL`; `image_object_key character varying NOT NULL`; `scope character varying NOT NULL`; `merchant_id integer NULL`; `target_type character varying NOT NULL`; `target_value character varying NULL`; `status character varying NOT NULL`; `starts_at timestamp with time zone NULL`; `ends_at timestamp with time zone NULL`; `sort_order integer NOT NULL`; `created_by_admin_id integer NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`.

Constraints:

- `banners_created_by_admin_id_foreign`: `FOREIGN KEY (created_by_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL`
- `banners_date_range_check`: `CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at)))`
- `banners_merchant_id_foreign`: `FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT`
- `banners_pkey`: `PRIMARY KEY (id)`
- `banners_scope_check`: `CHECK (((scope)::text = ANY ((ARRAY['GLOBAL'::character varying, 'MERCHANT'::character varying])::text[])))`
- `banners_scope_merchant_check`: `CHECK (((((scope)::text = 'GLOBAL'::text) AND (merchant_id IS NULL)) OR (((scope)::text = 'MERCHANT'::text) AND (merchant_id IS NOT NULL))))`
- `banners_sort_order_check`: `CHECK ((sort_order >= 0))`
- `banners_status_check`: `CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'SCHEDULED'::character varying, 'PUBLISHED'::character varying, 'ARCHIVED'::character varying])::text[])))`
- `banners_target_type_check`: `CHECK (((target_type)::text = ANY ((ARRAY['NONE'::character varying, 'STORE'::character varying, 'MENU'::character varying, 'URL'::character varying, 'PROMOTION'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX banners_merchant_id_status_index ON public.banners USING btree (merchant_id, status)`
- `CREATE UNIQUE INDEX banners_pkey ON public.banners USING btree (id)`
- `CREATE INDEX banners_status_starts_at_ends_at_sort_order_index ON public.banners USING btree (status, starts_at, ends_at, sort_order)`

### audit_logs

Columns: `id bigint NOT NULL`; `actor_type character varying NOT NULL`; `actor_id integer NULL`; `action character varying NOT NULL`; `entity_type character varying NOT NULL`; `entity_id character varying NULL`; `request_id character varying NULL`; `ip_address character varying NULL`; `metadata jsonb NOT NULL`; `created_at timestamp with time zone NOT NULL`.

Constraints:

- `audit_logs_actor_type_check`: `CHECK (((actor_type)::text = ANY ((ARRAY['ADMIN'::character varying, 'MERCHANT_STAFF'::character varying, 'SYSTEM'::character varying])::text[])))`
- `audit_logs_pkey`: `PRIMARY KEY (id)`

Indexes (including constraint-backed indexes):

- `CREATE INDEX audit_logs_action_created_at_index ON public.audit_logs USING btree (action, created_at)`
- `CREATE INDEX audit_logs_actor_type_actor_id_created_at_index ON public.audit_logs USING btree (actor_type, actor_id, created_at)`
- `CREATE INDEX audit_logs_created_at_index ON public.audit_logs USING btree (created_at)`
- `CREATE INDEX audit_logs_entity_type_entity_id_index ON public.audit_logs USING btree (entity_type, entity_id)`
- `CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id)`

### notification_outbox

Columns: `id integer NOT NULL`; `event_type character varying NOT NULL`; `order_id integer NOT NULL`; `recipient_line_user_id character varying NOT NULL`; `payload jsonb NOT NULL`; `status character varying NOT NULL`; `attempts integer NOT NULL`; `next_attempt_at timestamp with time zone NOT NULL`; `sent_at timestamp with time zone NULL`; `last_error_code character varying NULL`; `dedupe_key character varying NOT NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`.

Constraints:

- `notification_outbox_attempts_check`: `CHECK ((attempts >= 0))`
- `notification_outbox_dedupe_key_unique`: `UNIQUE (dedupe_key)`
- `notification_outbox_order_id_foreign`: `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `notification_outbox_pkey`: `PRIMARY KEY (id)`
- `notification_outbox_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'RETRY'::character varying, 'SENT'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX notification_outbox_dedupe_key_unique ON public.notification_outbox USING btree (dedupe_key)`
- `CREATE INDEX notification_outbox_order_id_index ON public.notification_outbox USING btree (order_id)`
- `CREATE UNIQUE INDEX notification_outbox_pkey ON public.notification_outbox USING btree (id)`
- `CREATE INDEX notification_outbox_status_next_attempt_at_index ON public.notification_outbox USING btree (status, next_attempt_at)`

### system_settings

Columns: `id integer NOT NULL`; `setting_key character varying NOT NULL`; `setting_value jsonb NOT NULL`; `is_public boolean NOT NULL`; `updated_by_admin_id integer NULL`; `updated_at timestamp with time zone NOT NULL`.

Constraints:

- `system_settings_pkey`: `PRIMARY KEY (id)`
- `system_settings_setting_key_unique`: `UNIQUE (setting_key)`
- `system_settings_updated_by_admin_id_foreign`: `FOREIGN KEY (updated_by_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX system_settings_pkey ON public.system_settings USING btree (id)`
- `CREATE UNIQUE INDEX system_settings_setting_key_unique ON public.system_settings USING btree (setting_key)`

### platform_admins

Columns: `id integer NOT NULL`; `username character varying NOT NULL`; `password_hash character varying NOT NULL`; `full_name character varying NOT NULL`; `email character varying NULL`; `role character varying NOT NULL`; `is_active boolean NOT NULL`; `last_login_at timestamp with time zone NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`; `deleted_at timestamp with time zone NULL`.

Constraints:

- `platform_admins_pkey`: `PRIMARY KEY (id)`
- `platform_admins_role_check`: `CHECK (((role)::text = ANY ((ARRAY['SUPER_ADMIN'::character varying, 'ADMIN'::character varying, 'SUPPORT'::character varying, 'FINANCE'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE UNIQUE INDEX platform_admins_active_username_unique ON public.platform_admins USING btree (lower((username)::text)) WHERE (deleted_at IS NULL)`
- `CREATE UNIQUE INDEX platform_admins_pkey ON public.platform_admins USING btree (id)`
- `CREATE INDEX platform_admins_role_is_active_index ON public.platform_admins USING btree (role, is_active)`

### idempotency_keys

Columns: `id integer NOT NULL`; `scope character varying NOT NULL`; `idempotency_key character varying NOT NULL`; `request_fingerprint character varying NOT NULL`; `status character varying NOT NULL`; `response_status integer NULL`; `response_body jsonb NULL`; `expires_at timestamp with time zone NOT NULL`; `completed_at timestamp with time zone NULL`; `created_at timestamp with time zone NOT NULL`; `updated_at timestamp with time zone NOT NULL`.

Constraints:

- `idempotency_keys_pkey`: `PRIMARY KEY (id)`
- `idempotency_keys_scope_idempotency_key_unique`: `UNIQUE (scope, idempotency_key)`
- `idempotency_keys_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PROCESSING'::character varying, 'COMPLETED'::character varying])::text[])))`

Indexes (including constraint-backed indexes):

- `CREATE INDEX idempotency_keys_expires_at_index ON public.idempotency_keys USING btree (expires_at)`
- `CREATE UNIQUE INDEX idempotency_keys_pkey ON public.idempotency_keys USING btree (id)`
- `CREATE UNIQUE INDEX idempotency_keys_scope_idempotency_key_unique ON public.idempotency_keys USING btree (scope, idempotency_key)`

