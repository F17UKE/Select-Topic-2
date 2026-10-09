# System Architecture

สถานะเอกสาร: Phase J production deployment preparation, 2026-10-07

## Runtime topology

```text
Customer LIFF / Merchant browser / Rider browser / Admin browser
                         |
                  HTTPS :443
                         |
          Frontend Ubuntu 10.0.7.5
          Nginx -> Next.js 127.0.0.1:3000
             |       |
             |       `-- pages and static assets
             |
             |-- /api/* -------------------------.
             |-- /api/webhooks/line ------------ |
             `-- /webhooks/line ---------------- |
                                                   v
                              Backend Ubuntu 10.0.7.6:3001
                              Express + services + workers
                                |                  |
                                |                  |-- LINE Login / Messaging API
                                |                  |-- SlipOK Check Slip
                                |                  `-- private S3-compatible storage
                                v
                         PostgreSQL 10.0.7.7:5432
```

Browser traffic enters through Nginx only. Next.js and Express are single systemd-managed processes.
The frontend has no database driver or database credentials. Express binds to the backend private
interface in production; PostgreSQL accepts the backend host only. HTTPS terminates at Nginx.
The services run as the unprivileged `select-topic-2` account, restart on failure, start at boot and
load secrets from root-owned files under `/etc/select-topic-2`, outside Git and the release directory.

## Application boundaries

| Boundary | Responsibility | Trust rule |
|---|---|---|
| Customer frontend | LIFF bootstrap, browsing, cart presentation, checkout, order history | `liff.isInClient()` is UX gating only; authorization comes from the server session |
| Merchant/Rider frontend | Browser login and role-specific operations | Never derives tenant or role from request data |
| Admin frontend | Platform operations, reports and moderation | Separate session and CSRF token |
| Express | Authentication, RBAC, validation, state machines, authoritative pricing | Treats all browser input as untrusted |
| PostgreSQL | Durable state, snapshots, ledgers, idempotency, deduplication and outbox | Migrations are additive after the V3 baseline |
| Private object storage | Slips, Admin banners and uploaded catalog media | Private bucket; DB stores object keys; no public-read ACL |
| External providers | LINE and SlipOK | Adapter boundary, timeouts, normalized results and redacted logs |

## Authentication and sessions

- Customer production authentication is LINE/LIFF-only. Express verifies the LINE ID token,
  including issuer, expiry, audience and subject, then creates an HTTP-only server session.
- Merchant and Rider accounts use `merchant_staffs.username` with bcrypt password hashes. The
  session determines merchant and role. Manager, Cashier, Kitchen and Rider permissions are
  enforced by backend middleware and services.
- Admin uses a separate durable session table, hashed session/CSRF tokens and backend RBAC.
- Mock customer/staff authentication is limited to development/test and fails production startup.
- Production cookies are HTTP-only, Secure and SameSite=Lax. Express trusts exactly the configured
  proxy hop count.

## Core data flows

### Order and payment

1. Backend quotes current menu/options, delivery fee and one eligible discount source.
2. `POST /api/orders` revalidates the quote, locks quota/counter rows, persists snapshots and
   stores/reuses a customer-scoped idempotency result.
3. PromptPay QR uses the order total and merchant PromptPay identity stored in PostgreSQL.
4. Slip upload validates byte size, MIME type and magic bytes before private storage.
5. SlipOK results are normalized. Backend independently checks amount, recipient and globally
   unique transaction reference before marking a payment paid.
6. State transitions write the order change and notification outbox event in one DB transaction.
   Provider delivery happens after commit and retries without rolling back business state.

Order transitions:

```text
PENDING -> ACCEPTED -> PREPARING -> READY -> DELIVERING -> COMPLETED
    `-> REJECTED
```

PromptPay acceptance requires `payment_status=PAID`. Rider assignment is Manager-only and locked.
Order receipts render item, option, delivery-address, fee, promotion and coupon snapshots.

### Customer engagement

- Reviews are limited to one customer-owned completed order and can be hidden/published by Admin.
- Favourites are customer-scoped and idempotent.
- Reorder produces a preview from current catalog price, stock and availability.
- Checkout applies one automatic promotion or one coupon, never both.
- Customer notifications are provider-independent records; LINE delivery internals stay private.

## Durable operational controls

- `idempotency_keys` survives process restarts and serializes duplicate order creation.
- `line_webhook_events` deduplicates LINE deliveries across restarts.
- `notification_outbox` supplies retry and dedupe for LINE notifications.
- `payment_slips.purge_after` and verification response retention remove private payloads while
  keeping the financial ledger and order history.
- PostgreSQL row locks protect merchant order numbers, quotas, state transitions and rider assignment.
- Audit logs record Admin and merchant management mutations with sensitive metadata redacted.

## Deployment-owned operations

Nginx/TLS certificate renewal, PostgreSQL backups/restore drills, outbox/retention worker scheduling,
object-storage lifecycle policy, log rotation, edge rate limiting and monitoring alerts are deployment
operations. The repository provides config and scripts but does not provision Cloud/firewall resources.

## Current intentional limits

- Order chat tables exist, but chat business logic/UI is deferred.
- Refunds remain manual; rejecting a paid order flags manual action without rewriting payment state.
- Pickup completion UI and rider dispatch expansion are deferred.
- Stock is manual and is not reserved/decremented automatically.
- Login throttling is process-local; production should add an Nginx/edge/shared limiter before scale-out.
