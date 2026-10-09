# Phase H additive migration review

Proposed before implementation on 2026-10-07. Migrations 001–005 remain unchanged.

## Why migration 006 is required

The current schema has no durable model for reviews, customer favourites, coupon quotas/redemptions,
or in-app customer notifications. `notification_outbox` is a LINE delivery queue and must not be
exposed as customer history. Orders currently support one automatic promotion snapshot only.

## Additive changes

- `reviews`: one review per completed order, customer and merchant derived from the order, rating
  1–5, optional trimmed comment up to 1,000 characters, `PUBLISHED`/`HIDDEN` moderation state.
- `customer_favorite_merchants`: unique customer/merchant pair with durable creation time.
- `coupons`: normalized case-insensitive code, optional merchant scope, percentage/fixed/free-delivery
  rules, global and per-customer limits, current usage count, schedule, active/deleted state and admin
  creator.
- `coupon_redemptions`: one row per order with the applied discount and customer attribution.
- `customer_notifications`: provider-independent order event projection with a unique event key,
  read state and optional order reference.
- `orders.coupon_id` and `orders.coupon_snapshot`: preserve the selected coupon identity and immutable
  calculation inputs. Existing `discount_amount` remains the single authoritative discount amount.

## Discount policy

An order may use an automatic promotion or one coupon, never both. If `couponCode` is supplied,
`promotionId` must be null. Existing orders and promotion behaviour remain valid. Coupons use the
same integer-satang calculator and the existing rule that payable total must remain at least one
satang. Coupon resolve, quota checks, order creation, redemption and `usage_count` increment occur in
one transaction while the coupon row is locked.

## Constraints and indexes

- Unique: `reviews.order_id`, favourites `(customer_id, merchant_id)`, lower-case active coupon code,
  `coupon_redemptions.order_id`, and `customer_notifications.event_key`.
- Checks: review rating/status, coupon type/value/date/limits/counts, non-negative redemption amount,
  notification type, and exactly one order discount source.
- Indexes: reviews `(merchant_id,status,created_at)`, favourites `(customer_id,created_at)`, coupon
  eligibility/scope, redemptions by coupon/customer, notifications `(customer_id,is_read,created_at)`.

## Compatibility and rollback

All new order columns are nullable; existing promotion and no-discount rows satisfy the replacement
discount-source constraint. No payment/order state transition changes. Rollback is allowed only when
review, favourite, redemption and notification history is empty and no order references a coupon;
otherwise it fails instead of deleting financial or customer history silently. Unused coupon
definitions are configuration data and are removed with the coupon table during an intentional down.
