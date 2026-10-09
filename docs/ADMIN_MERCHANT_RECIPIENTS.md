# Merchant Payment Recipient Management — 2026-10-09

## Existing contract audited from source

EasySlip selects `EASYSLIP_MERCHANT_ACCOUNTS[String(order.merchant_id)]`. There is no slug,
account-name or bank-account-only QR mode. The exact existing ENV format is:

```json
{
  "<merchant-id>": {
    "promptpayType": "PHONE",
    "promptpayId": "<merchant's exact stored PromptPay ID>",
    "bankCode": "<3 digits>",
    "bankNumber": "<6-20 digits>"
  }
}
```

The preflight requires exact PromptPay type/ID equality with the merchant row used by the order,
three bank-code digits and 6–20 bank-account digits. Merchant QR validation accepts PHONE (10
local digits beginning 0), NATIONAL_ID/TAX_ID (13 digits), EWALLET (15 digits); the existing QR
implementation/support restrictions still apply. Bank codes preserve leading zeroes.

The provider sends `image`, `remark=order_code`, `matchAmount`, `matchAccount=true`,
`checkDuplicate=true`. Success independently requires both `matchedAccount.bank.code/bankNumber`
and `rawSlip.receiver.bank.id/account.bank.account` to equal the selected merchant's account.
Only spaces/hyphens in provider account numbers are normalized; masked digits never prove a match.
Amount/reference/duplicate validation and payment state transitions remain unchanged.

## Admin workflow

Admin → ร้านค้า → Local Kitchen (or another store) → การรับชำระเงิน.
Only SUPER_ADMIN can read/change this mapping through its dedicated admin API. Normal Admin,
customer, merchant staff and rider sessions cannot manage it. Super Admin is intentionally
platform-wide; targeting another merchant as Super Admin is allowed, but a request cannot inject
merchantId/PromptPay/recipient fields in its body. The path merchant must exist and not be deleted.

The owner enters the enrolled EasySlip bank code and bank account number. PromptPay type/ID
are derived on the server from that store's existing QR identity and shown masked/read-only.
Account name is omitted because the current verifier does not use it. This form does not alter
the merchant QR or enroll an account with EasySlip. No real bank information was supplied for the owner.
If the merchant QR identity changes later, readiness/preflight fails until the owner reviews and
saves the mapping again. There is no historical recipient versioning/cutover in this phase.

Current account stays masked after save. The edit number is empty; blank preserves the current
DB/ENV number. Mask text cannot be submitted as a new account. Save/clear require explicit UI
confirmation; requests require Super Admin session + CSRF + `confirm: true`. Source is DATABASE,
ENVIRONMENT or NOT_CONFIGURED, with a separate readiness/enabled state.

## Storage and resolution

No migration/schema change is needed. Reuse private `integration_settings.secret_values` with
one reserved `MERCHANT_RECIPIENT_<canonical merchant id>` entry per override. The JSON mapping
(including `enabled`) is encrypted using the existing AES-256-GCM envelope and field-bound AAD.
It is excluded from normal integration field listing and the secret-reveal allowlist. Master-key
backup requirements are identical to other encrypted settings.

DB override → existing ENV mapping for that same merchant → no mapping.
An explicit disabled DB override suppresses the ENV mapping. Clearing the override restores ENV
if available. Malformed ENV JSON remains a configuration error; it is not silently ignored.
Updates lock the merchant then the existing singleton settings row, check its version, update
ciphertext/version and append the audit event in one transaction. Concurrent or stale settings
edits get 409 and must reload. No FK/table/index is added; merchant existence/ownership is checked
in the service, and deleted merchants are excluded from readiness counts.

Runtime config is resolved from DB for each payment operation and stays immutable for that
operation. The current service derives merchant ID and PromptPay from the customer-owned order;
frontend-supplied expected recipients cannot override it. An absent/disabled mapping stops at the
existing preflight, before storage/provider calls, with `payment_recipient_not_configured` and
“ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน”. No payment becomes PAID without matching.
A zero-entry map no longer fails global config construction: merchant-specific preflight is the
fail-closed boundary, so the customer receives the specific setup message.

## APIs and readiness

- GET `/api/admin/merchants/:id/payment-recipient`: masked bank/PromptPay identifiers, source,
  readiness, bank code, enabled, settings version. `Cache-Control: no-store`.
- PATCH same route: `{ version, bankCode, bankNumber, enabled, confirm: true }`.
- Clear via PATCH: `{ version, clear: true, confirm: true }`.
- Existing integration GET adds `merchant_recipients` configured/total and active configured/total.
  The EasySlip section shows these counts independently from API account verification.

The API VERIFIED label retains the existing transient `/v2/info` result/version design; no new
persisted verification claim is invented. Recipient configuration does not prove the real bank
account is enrolled or that a real slip passes. The owner explicitly selects `easyslip`; saving a
mapping never changes PAYMENT_VERIFICATION_MODE or calls EasySlip.

Audit events MERCHANT_RECIPIENT_CHANGED / MERCHANT_RECIPIENT_CLEARED contain actor, merchant,
version, enabled and source only. Neither full bank/PromptPay identifiers nor ciphertext are
returned by admin reads or written to audit metadata.

## Boundaries

Centralized platform payment, Finance/settlement, GP/wallet/withdrawals: NOT ENABLED/UNCHANGED.
Payment logic: UNCHANGED except configuration source and safe setup-error text.
No production credentials, schema changes, real slip tests, deployment, commit or push.
