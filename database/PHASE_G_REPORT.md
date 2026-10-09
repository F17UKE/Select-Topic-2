# Phase G — Merchant Professional Management

Local implementation complete. Overall verification PARTIAL: backend/API flow and browser
management/order state flow PASS; the automated browser's file chooser did not return an
upload event. The slip step was verified through local HTTP with a synthetic PNG, then
confirmed PAID in the merchant UI. Do not call this an entirely browser-driven upload E2E.
No Cloud deployment, firewall change, commit or push.

## Milestones and policy

| Milestone | Implemented |
|---|---|
| G1 dashboard/navigation | SQL KPIs, active queues, recent orders, snapshot best sellers, quick actions |
| G2 store | name/phone/location/manual open, masked PromptPay, gallery, private uploads, opening hours |
| G3 categories | create/edit/active, atomic up/down reorder, soft delete, tenant constraint |
| G4 menu | create/detail/edit/soft delete, images, filters/search/pagination, manual stock +/− and availability |
| G5 options | group/choice CRUD, ownership chain, required/min/max validation, snapshot preservation |
| G6 delivery | own merchant+soi fee upsert, fee zero, remove service area, immutable old delivery fee |
| G7 staff | own staff CRUD/active/role/password reset, bcrypt12, session revocation, last-manager lock |
| G8 riders | staff management, active jobs, derived AVAILABLE/BUSY/OFFLINE, completed today/history |
| G9 history | merchant scoped, code/date/status/payment filters, server pagination |
| G10 reports | today/7/30 days, SQL summary/daily/status/menu/choice aggregates |
| G11 content | read-only own/global promotions; own banners and published global previews |

MANAGER: every management operation. CASHIER: dashboard, categories/menu read, history/basic reports.
KITCHEN: dashboard without financial KPIs and categories/menu read. RIDER: management denied;
existing rider portal unchanged. Backend enforces every permission, regardless of hidden controls.
Manager writes use merchant FOR UPDATE, revalidate actor, and audit in the same transaction.
Staff mutations also lock target staff before job checks, matching existing dispatch's rider lock.
CSRF defense on new writes: same-origin production policy plus required X-Merchant-Request: 1
custom header (no cross-origin CORS grant), authenticated HttpOnly SameSite staff session.
No password/hash/full PromptPay in management responses or audit metadata.

## API map

All following routes are under `/api/merchant/management`:

- GET `/dashboard`, `/store`; PATCH `/store`; PUT `/store/hours`.
- POST `/images/:namespace` (`menu` or `merchant`, multipart image <=5 MB).
- POST `/store/gallery`; PATCH/DELETE `/store/gallery/:id`.
- GET/POST `/categories`; PATCH/DELETE `/categories/:id` (PATCH direction -1/+1 to reorder).
- GET/POST `/menu`; GET/PATCH/DELETE `/menu/:id`.
- POST `/menu/:itemId/groups`; PATCH/DELETE `/menu/:itemId/groups/:id`.
- POST `/menu/:itemId/groups/:groupId/choices`; PATCH/DELETE same plus `/:id`.
- GET `/delivery-fees`; PUT `/delivery-fees/:soiId` with enabled and fee.
- GET/POST `/staff`; PATCH `/staff/:id` (password, role, is_active or profile fields).
- GET `/riders`, `/riders/:id/history`, `/history`, `/reports?days=1|7|30`.
- GET `/promotions`, `/banners`, `/banners/:id/image`.

Catalog images: GET `/api/catalog/images/:namespace/:merchantId/:file`. The key must match a
current DB catalog reference; slip namespace/path traversal denied. Private S3 bucket stays private;
no public-read ACL or signed URL persisted. Local/S3 interface remains shared with slip storage.

## Schema

005 creates only merchant_opening_hours. Proposal preceded implementation. 001–004 were not edited.
31 application tables; no pending migrations. Weekly seven-day schedule, Bangkok timezone;
manual is_open=false wins; no schedule preserves old behavior. Both browse and new checkout/order
creation use the same status calculation. The only customer UI change is using accepting_orders
for the open/closed label so it agrees with schedule enforcement.

## Metrics

Reports use orders **created** during the Bangkok date range. Revenue/AOV = COMPLETED + PAID
net total including delivery, after promotion discount. Non-completed PAID orders are not revenue.
Today completed count is completed orders in that creation cohort; rider completed-today uses
completed_at. Active queue counts include older unfulfilled orders. Top menu/choice names are
historical snapshots, not renamed catalog data. No SQL aggregation mixes merchants.

## Verification evidence

Baseline passed before implementation: migration 001–004, DB verify, existing 117 backend tests,
8 architecture/banner tests, lint/build, customer/payment/merchant/rider/admin smoke.
Each G1–G11 milestone ran targeted tests before proceeding. Expanded tests cover catalog images,
category/menu ownership, option chain, last manager concurrent demotions, rider assignment race,
new checkout price vs historical snapshot, suspended merchant, and report tenant isolation.
Opening-hours boundary tests and mocked S3 namespace tests added; no provider HTTP called.

Browser management: manager login → store save → category Phase G Demo → menu Phase G Demo Rice
→ option Demo Egg +10 → unavailable/available → delivery fee save → synthetic rider create → reports.
Customer: sees new menu, adds options/cart, checkout promotion 10%: 130 + 15 - 13 = 132.
Created local LOC-000006 (id 808). Synthetic slip uploaded through HTTP after browser chooser
limitation; PAID verified in UI. Browser accept → preparing → KDS complete → ready → assign local
rider → rider start/complete → customer COMPLETED + PAID. Admin sees order/audit changes.

Responsive: 13 merchant pages × 390/430/768/1280/1440, no document horizontal overflow (65 checks),
plus initial report checks. Tables scroll within container. Image sizing warnings found during
checking were corrected and rechecked before completion. Final check counts/commands are in VERIFICATION.md.

## Limitations / Phase H

- Stock remains manual; order creation still checks aggregate requested quantity but does not reserve
  or decrement. A: decrement at accept fits merchant decision but paid requests can oversubscribe before
  acceptance. B: reserve at order creation needs expiry/release and abuse controls; strongest availability
  guarantee but most transaction work. C: decrement at paid aligns with payment but requires a policy
  for paid orders with exhausted stock and compensation. Recommend a separately approved reservation
  design before advertising guaranteed stock; no half-implemented accounting in Phase G.
- Options/groups are physically deleted only after nulling old receipt master-choice FK; receipt names,
  prices and quantities remain unchanged. Menu/category soft delete. Gallery deletion removes reference;
  replaced/unattached catalog image objects need a future orphan cleanup policy (private storage).
- Overnight/multiple opening intervals are not supported. No hours rows = manual operation.
- PromptPay edits blocked while unpaid nonterminal orders exist; no payment/refund behavior changed.
- Promotions/banner CRUD remain Admin-owned. No durable merchant notification inbox: defer to Phase H;
  dashboard displays actual recent orders, not fake read/unread state. CSV/GPS not added.
- Real object provider/LINE/SlipOK manual tests not run in this local phase.
- Browser upload automation remains unverified; HTTP upload and mocked/local adapter tests pass.

## Dependency audit

`npm audit --omit=dev`: 3 HIGH packages (PM2 → chokidar → braces). Full audit: 7 HIGH packages
including the ESLint/fast-glob/micromatch chain. Same braces advisory, not seven distinct exploits.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) still lists no patched
version as checked 2026-10-06; affected <=3.0.3. Audit suggestions are breaking downgrades, not a
safe upgrade. No force fix. PM2 watch remains disabled; no new request-to-glob input was introduced.
This mitigation is not a claim that the vulnerability is fixed.

## Local data and Git

Existing seed, counters and historical transactions were not reset or deleted. Browser-created demo
catalog/staff and the completed order are retained for review; the one-use demo promotion is exhausted.
Automated test fixtures roll back or remove only their own isolated fixture rows. Synthetic slip files
remain in ignored backend/storage and follow existing purge_after retention. Portable PostgreSQL
continues listening only on 127.0.0.1:5432. Prior uncommitted Phase E/F changes preserved.

## Phase G files

New: migration005; merchant-management/router, store/catalog/delivery/staff/report/content modules,
merchant-validation/opening-hours; merchant-management integration/opening-hours tests; Phase G docs.
New frontend pages: menu/new/detail, categories, store, delivery-fees, staff, riders, history, reports,
promotions, banners; six management/editor/catalog/operations/reports/content components.
Updated: app/server wiring; staff session revocation; slip-storage namespaces; store-repository and
order-service schedule check; local DB verification; S3 tests; merchant shell/dashboard/order/kitchen
navigation; home/store status labels; scoped CSS; root test script; README/context/schema/verification.
No dependency manifest versions or package lock changed in Phase G.

### Exact Phase G file manifest

- `DATABASE_SCHEMA.md`
- `PROJECT_CONTEXT.md`
- `README.md`
- `VERIFICATION.md`
- `package.json`
- `database/PHASE_G_MIGRATION_REVIEW.md`
- `database/PHASE_G_REPORT.md`
- `backend/migrations/202610060005_merchant_opening_hours.cjs`
- `backend/scripts/verify-local-db.cjs`
- `backend/src/app.cjs`
- `backend/src/server.cjs`
- `backend/src/staff-auth.cjs`
- `backend/src/slip-storage.cjs`
- `backend/src/store-repository.cjs`
- `backend/src/order-service.cjs`
- `backend/src/merchant-management.cjs`
- `backend/src/merchant-management-router.cjs`
- `backend/src/merchant-store-management.cjs`
- `backend/src/merchant-catalog-management.cjs`
- `backend/src/merchant-delivery-management.cjs`
- `backend/src/merchant-staff-management.cjs`
- `backend/src/merchant-report-management.cjs`
- `backend/src/merchant-content-management.cjs`
- `backend/src/merchant-validation.cjs`
- `backend/src/opening-hours.cjs`
- `backend/test/merchant-management.integration.test.cjs`
- `backend/test/opening-hours.test.cjs`
- `backend/test/slip-object-storage.test.cjs`
- `frontend/app/globals.css`
- `frontend/app/stores/[id]/page.js`
- `frontend/components/home/store-card.js`
- `frontend/components/merchant-shell.js`
- `frontend/components/merchant-management.js`
- `frontend/components/merchant-editors.js`
- `frontend/components/merchant-catalog.js`
- `frontend/components/merchant-operations.js`
- `frontend/components/merchant-reports.js`
- `frontend/components/merchant-content.js`
- `frontend/app/merchant/page.js`
- `frontend/app/merchant/orders/page.js`
- `frontend/app/merchant/orders/[id]/page.js`
- `frontend/app/merchant/kitchen/page.js`
- `frontend/app/merchant/menu/page.js`
- `frontend/app/merchant/menu/new/page.js`
- `frontend/app/merchant/menu/[id]/page.js`
- `frontend/app/merchant/categories/page.js`
- `frontend/app/merchant/store/page.js`
- `frontend/app/merchant/delivery-fees/page.js`
- `frontend/app/merchant/staff/page.js`
- `frontend/app/merchant/riders/page.js`
- `frontend/app/merchant/history/page.js`
- `frontend/app/merchant/reports/page.js`
- `frontend/app/merchant/promotions/page.js`
- `frontend/app/merchant/banners/page.js`

Final service recheck on 2026-10-07 restarted the same local runtimes after all three were found stopped. DB verification and API/database health passed again; no data reset. See VERIFICATION.md for final command results.
