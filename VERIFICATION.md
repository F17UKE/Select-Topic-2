# LINE Integration — local verification 2026-10-02

Scope: LIFF initialization, LINE Login ID-token verification, Messaging API abstraction,
Flex Messages, webhook signature validation and order-event notifications. No Cloud
deployment, firewall, Git commit/push, real CheckSlip, refund, chat, reviews or banners.

## Schema decision

Customer and staff LINE identities use the canonical `line_user_id` columns. The later additive
production-hardening migration adds durable webhook event deduplication and a transactional
notification outbox. OA relationship state is still intentionally not stored.

## Authentication and LIFF

`POST /api/auth/line` accepts an LIFF ID token only. The backend submits it to LINE's
token verification endpoint with `LINE_CHANNEL_ID`, then independently checks issuer,
expiry, audience and verified `sub`. Any `line_user_id` or `userId` supplied by the
frontend is ignored. Existing customers are matched by verified `sub`; a new identity
creates a customer and returns `onboarding_required=true` until phone/address exist.

The frontend loads the official LIFF SDK only when `/api/auth/config` reports line mode:

```text
liff.init -> liff.login when needed -> getIDToken -> POST /api/auth/line
-> HTTP-only server session
```

Mock development mode continues to use the synthetic seeded customer and never loads
the LIFF SDK.

## Messaging and Flex events

`LINE_MESSAGING_MODE` supports `disabled`, `mock` and `real`. Tests inject a fake
provider; they never call LINE. Flex builders cover:

- `PAYMENT_VERIFIED`
- `ORDER_ACCEPTED`
- `PREPARING`
- `READY`
- `DELIVERING`
- `COMPLETED`
- `REJECTED`

Each notification includes order code, store, current event/status and an order-status
CTA. Payment provider and slip internals are excluded. Notifications run only after the
database transaction commits. Provider failure is safely logged by event/order/error
code and never rolls back payment or order state.

## Webhook

`POST /api/webhooks/line` and the legacy proxy-compatible `/webhooks/line` read the raw
request body before JSON parsing and verify `x-line-signature` with HMAC-SHA256 and a
timing-safe comparison. Invalid signatures return 401. Valid follow/unfollow/postback
events are accepted; duplicate `webhookEventId` values are ignored in-process.

## Verification results

| Check | Result |
| --- | --- |
| `npm run verify` | PASS |
| Backend tests/subtests | 68 PASS |
| Architecture tests | 4 PASS |
| Production frontend build | PASS |
| `npm run test:smoke` | PASS; unsigned webhook returns 401 |
| `npm run test:smoke:local` | PASS; mock customer through COMPLETED |
| Real LINE HTTP calls in tests | 0 |

Security coverage includes invalid token, wrong audience, spoofed identity fields,
production mock guards, invalid/valid webhook signatures and sanitized Messaging API
errors. Notification coverage includes all seven events, duplicate suppression and both
payment and merchant transaction survival when LINE fails.

## Credentials still required for manual LIFF verification

- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET` or `LINE_WEBHOOK_SECRET`
- `LINE_LIFF_ID`
- `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
- Public HTTPS LIFF endpoint and registered webhook URL

No real values are stored in the repository.
