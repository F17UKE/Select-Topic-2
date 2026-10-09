# Phase H — Customer Engagement & Commerce Completion

Status: **PASS on local development environment** (2026-10-07). Cloud was not deployed and Git was
not committed or pushed.

## Schema

Additive migration `202610070006_customer_engagement.cjs` is batch 6. Migrations 001–005 remain
unchanged. It adds `reviews`, `customer_favorite_merchants`, `coupons`, `coupon_redemptions` and
`customer_notifications`, plus nullable `orders.coupon_id` and `orders.coupon_snapshot`. The database
contains 36 application tables and has no pending migration.

The order constraint enforces automatic promotion XOR coupon. `discount_amount` remains the total
authoritative discount. Coupon snapshots include ID/code/name/type/rule inputs, calculation version,
discount satang and quota policy. Rollback refuses customer/financial history or order references;
unused coupon definitions are removed only during an intentional down.

## Features and security

- **Reviews:** one published review per customer-owned `COMPLETED` order; merchant derives from order;
  integer rating 1–5; trimmed optional comment up to 1,000 characters; SQL average/count; Admin
  hide/publish with audit; Merchant Manager/Cashier read their own published reviews only.
- **Favourites:** authenticated customer-only add/list/remove, idempotent duplicate operations and
  tenant isolation. Store cards/detail use optimistic UI with rollback and backend authority.
- **Reorder:** completed-order preview resolves the current merchant, menu, category, stock, price and
  exact option choices. Missing/disabled choices and suspended stores are reported; available rows are
  rebuilt into the normal cart and pass through ordinary checkout validation.
- **Coupons:** normalized case-insensitive codes; percentage/fixed/free-delivery types; schedule,
  merchant scope, minimum/cap, global and per-customer quotas; integer-satang calculation shared with
  the promotion engine. Order creation locks the coupon row and commits redemption, usage increment,
  order and idempotency result together. Replay cannot consume quota twice.
- **Promotion discovery:** Home and `/promotions` show only enabled, in-window promotions; expiry,
  minimum and benefit are displayed. Existing safe banner target handling covers `PROMOTION`.
- **Notifications:** customer-facing projection is independent from LINE provider payloads. Domain
  events write unique records transactionally; provider failure cannot remove the event. APIs enforce
  customer ownership for list/read/read-all.
- **Personalization:** Home adds compact active promotion, favourite stores, recent order and unread
  badge sections only when data exists. Merchant lists calculate rating/favourite state in SQL without
  application N+1 queries.

## Routes

Customer APIs:

- `GET /api/customer/favorites`
- `POST|DELETE /api/customer/favorites/:merchantId`
- `GET /api/merchants/:id/reviews`
- `GET|POST /api/orders/:id/review`
- `POST /api/orders/:id/reorder-preview`
- `GET /api/customer/notifications`
- `PATCH /api/customer/notifications/:id/read`
- `POST /api/customer/notifications/read-all`
- `GET /api/promotions`

Admin APIs add review list/moderation and coupon list/create/update/disable under `/api/admin` with
CSRF, RBAC and audit. Merchant adds `GET /api/merchant/reviews` with MANAGER/CASHIER policy.

Frontend adds `/favorites`, `/promotions`, `/notifications`, `/admin/coupons`, `/admin/reviews` and
`/merchant/reviews`; Home, store detail, checkout, completed order detail and Profile were extended.

## Verification

- PostgreSQL: PASS at `127.0.0.1:5432`; 001–006 complete; 36 tables; no pending migration.
- `npm run verify`: PASS — 144 backend tests, 8 architecture tests, lint and 43-route build.
- Phase H targeted suite: PASS — 8 tests.
- Local customer/payment/promotion/Admin smoke: PASS.
- Merchant management smoke: PASS — 16 tests.
- Production process smoke: PASS.
- Full browser flow: PASS through paid checkout, Manager/KDS, Rider completion, review and reorder.
- Admin browser verification: PASS for review moderation, coupon usage and historical order snapshot.
- Responsive: PASS at widths 390, 393, 430, 768 and 1280 with no horizontal overflow.
- Fresh browser console after customer Home load: 0 errors and 0 warnings.

## Known limitations

1. One discount source per order; coupon stacking and automatic best-discount selection are deferred.
2. Coupon quota is consumed when the order is created and is not automatically returned after later
   cancellation or rejection.
3. Customers cannot edit/delete reviews in this phase; Admin only changes visibility.
4. Admin owns coupon mutations; Merchant coupon creation is deferred.
5. Personalization is rule-based (favourites, recent order, active promotions), without recommendation
   AI or customer-history scoring.
6. `npm audit --omit=dev` still reports 3 HIGH findings in the known PM2 `braces → chokidar` chain;
   the proposed force fix is a breaking downgrade and was not applied.
