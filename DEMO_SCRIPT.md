# Local Demo Script (5–10 minutes)

## Prepare

```powershell
npm run start-db
npm run db:status --workspace backend
npm run db:seed --workspace backend
npm run db:verify-local --workspace backend
```

Start `npm run dev:backend` and `npm run dev:frontend` in two terminals. Open
`http://127.0.0.1:3000`. The seed is restricted to the loopback database
`select_topic_2_local`; rerunning it updates named demo records without duplicating them.

Local synthetic credentials:

| Portal | Account | Password/method |
|---|---|---|
| Customer | `U_LOCAL_CUSTOMER_001` | Home mock-login button |
| Merchant Manager | `local_manager` | `local-development-only` |
| Rider | `local_rider` | `local-development-only` |
| Admin | `local_super_admin` | `local-admin-only` |

These credentials must never be used outside local development.

## Demo flow

1. **Customer Home (1 minute)** — mock login, show the scheduled banner, three stores, favourite,
   search, promotions and the recent completed order. Open Local Kitchen and show ratings/menu/options.
2. **Checkout (1–2 minutes)** — add Local Basil Rice with options, open cart/checkout, select the Home
   address and apply `WELCOME10`. Explain that the backend recalculates price/fee/discount and stores
   immutable order snapshots.
3. **Payment (1 minute)** — create the order, show the PromptPay QR and use the local mock slip flow.
   Confirm the customer order becomes PAID while order status remains PENDING.
4. **Merchant/KDS (1–2 minutes)** — open `/merchant`, sign in as Manager, accept the order, start
   preparation, complete KDS items and mark Ready. Show the order detail uses snapshots.
5. **Dispatch (1 minute)** — assign `local_rider`, sign in at `/rider`, start delivery and complete it.
   Refresh the customer order to show COMPLETED.
6. **Engagement (1 minute)** — submit a 5-star review, add/remove favourite, preview reorder and show
   the notification history.
7. **Admin (1–2 minutes)** — sign in at `/admin/login`, show dashboard, order/payment detail, merchant,
   banner/promotion/coupon, review moderation, audit log and system status. Avoid changing production-like
   configuration during a demo.

## Expected demo data

- 3 merchants, 7 categories and 19 menu items with option groups/choices.
- Manager, Cashier, Kitchen and Rider staff for Local Kitchen.
- Delivery fees for three sois, one published banner, active promotion and `WELCOME10` coupon.
- One synthetic customer with two addresses and an idempotent completed order/review.

## Stop

Stop the two Node terminals with `Ctrl+C`, then:

```powershell
npm run stop-db
```

Do not reset the database. Local orders created during the demo are retained unless a specific test
script documents its own transaction cleanup.
