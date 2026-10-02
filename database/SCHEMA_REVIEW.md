# Schema V3 review decision

Status: **approved and implemented in the unshipped initial migration**.

Approval scope:

- Core V3 tables, constraints and indexes.
- `order_messages` and `order_chat_read_states` schema foundation.
- Local development seed data and local PostgreSQL setup.
- Reviews and banners remain deferred.
- No business logic for LINE, orders, payment, merchant dashboard or chat.

The baseline has never been deployed or migrated to Cloud. Because there is no
released migration history to preserve, the initial migration was revised in place.
If any environment applies this migration, future schema changes must use new additive
migrations; do not edit the applied file.

## Approved decisions

| Area | Schema V3 decision |
| --- | --- |
| Customer identity | LINE/LIFF first; `customers.line_user_id` is required and unique. No customer password or Google identity columns. |
| Addresses | Multiple typed addresses with dormitory/soi, room, label, contact phone and one partial-unique default per customer. |
| Merchant | Business entity contains store data, phone, location, PromptPay and open state; staff accounts own authentication and LINE identities. |
| Images | `merchant_images` holds primary and gallery images; one partial-unique primary per merchant. |
| Menu | Merchant-owned categories are required. Composite FKs prevent category/menu and order/menu cross-merchant references. |
| Orders | One customer and one merchant; separate delivery/order/payment states; typed address, item name/price, choice name/price and delivery-fee snapshots. Delivery note is separate from item note. |
| Rider | `orders.assigned_rider_id` is restricted to a staff member of the same merchant. The service layer must additionally require the `RIDER` role. |
| Payments | Durable `payments`, expirable `payment_slips`, and CheckSlip audit rows in `payment_verifications`; durable transaction reference is unique. |
| Provider data | `provider_response JSONB` stores only an allowlisted/redacted response and has a separate purge timestamp. |
| LINE | Standard field `line_user_id`; integrations use LINE Login/LIFF, Messaging API and Webhook. |
| Chat | Actor-based `order_messages` and per-actor `order_chat_read_states`; APIs/realtime logic are deferred. |
| Status values | Text/varchar with named CHECK constraints instead of PostgreSQL native ENUM types. |
| Integrity | Nonnegative monetary/stock constraints, positive quantities, option min/max validation, uniqueness for fees/order numbers/default address and tenant-safe composite references. |

## Schema V3 tables

The initial migration creates 20 application tables:

`sois`, `dormitories`, `customers`, `customer_addresses`, `merchants`,
`merchant_images`, `merchant_staffs`, `delivery_fees`, `menu_categories`,
`menu_items`, `menu_option_groups`, `menu_option_choices`, `orders`, `order_items`,
`order_item_choices`, `payments`, `payment_slips`, `payment_verifications`,
`order_messages`, and `order_chat_read_states`.

Knex separately creates `knex_migrations` and `knex_migrations_lock`.

The detailed data dictionary is in `DATABASE_SCHEMA.md`. The executable definition is
`backend/migrations/202610020001_initial_schema.cjs`.

## Deferred work

- `reviews`: eligibility, moderation, edit window and visibility rules must be decided.
- `banners`: global/merchant scope, targeting and schedule rules must be decided.
- Application state transitions and role authorization.
- PromptPay QR generation, CheckSlip integration and retry/idempotency behavior.
- LINE webhook verification and Messaging API delivery.
- Chat transport, retention worker and read receipt business logic.

## Migration safety

The initial migration is only for a new, empty database. Local seed execution is
guarded so it only runs against database `select_topic_2_local` on loopback.
Cloud deployment, Cloud migration and firewall changes are outside this approval.
