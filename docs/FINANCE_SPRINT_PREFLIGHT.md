# Owner gate resolved — continued from this baseline

The Owner selected mandatory transfer reference + optional private proof, with normalization/shared uniqueness, confirmed actor/time and audit. This resolves the sole preflight blocker recorded below. Work resumed from this baseline; no new baseline audit, reset or discard was performed. See [current implementation report](FINANCE_SPRINT_REPORT.md) for migration 008 and verification.

The original preflight is preserved below as dated evidence; its BLOCKED/NOT IMPLEMENTED statements describe the pre-decision moment only.

# Final finance sprint — pre-migration audit

Date: 2026-10-09. Local only. Status: **BLOCKED at the requested pre-migration conflict gate**.

No application, UI, environment, existing migration or database schema was changed by this audit.
Existing uncommitted work is preserved. This report does not claim finance implementation or finance test coverage.

## Verified current state

- Local target: `select_topic_2_local` at `127.0.0.1:5432`, checked using the existing ignored environment configuration.
- PostgreSQL was already running; the existing `npm run start-db` script reused it.
- 39 public tables: 37 application tables and 2 Knex tables.
- Migrations 001–007 complete; pending 0. Migration 007 is `202610090007_integration_settings.cjs`.
- No finance tables, recipient-version columns or campaign funding-source columns exist yet.
- The next finance migration would use sequence **008**, not the 007 filename in the older proposal. No migration was created or applied.
- SHA-256 baseline captured for 316 existing tracked/unignored files before any report creation.

## Conflict requiring resolution before migration

The latest sprint's manual-settlement section permits an optional transfer reference/note and private proof only if supported.
The existing exact schema proposal instead requires a reference, bank execution timestamp and proof object for every confirmed transfer:

- [FINANCE_SCHEMA_PROPOSAL.md](FINANCE_SCHEMA_PROPOSAL.md), `finance_transfers_ck_8`:
  `status <> 'CONFIRMED' OR (external_reference IS NOT NULL AND bank_executed_at IS NOT NULL AND evidence_object_key IS NOT NULL)`.
- `finance_transfers_idx_1` provides shared bank-reference uniqueness across payout and refund:
  `(provider, source_account_key, external_reference) WHERE external_reference IS NOT NULL`.
- With a missing reference, a unique withdrawal/event key still prevents retrying the same internal withdrawal, but cannot identify the same external bank movement being attached to another withdrawal or refund.
- Current storage namespaces support slips, banners, menu and merchant images. There is no finance-proof upload/read authorization or dedicated long-term evidence retention workflow yet. Existing slip retention must not be reused for permanent finance evidence.

The sprint explicitly says to stop and report an important conflict before migration. A policy clarification was requested with these choices:

1. Require a canonical transfer reference at Confirm Paid; proof file optional, with actor/timestamp/audit. Recommended compromise, **not applied**.
2. Keep the proposal unchanged: require reference plus private evidence.
3. Allow reference/proof to be absent and explicitly accept the limitation on cross-transfer duplicate detection.

No option was assumed or implemented while awaiting the answer.

## Policies already resolved by the latest sprint

These are authorized implementation updates, not additional questions or blockers:

- New campaign funding is MERCHANT or PLATFORM; historical unresolved funding remains LEGACY_UNKNOWN without inference.
- Multiple partial refunds require exact component allocations and cumulative bounds. Replace the old full-refund-only unique-order restriction in the future migration.
- Advertising supports deferred revenue, served/unserved allocation, pre-activation full refunds, no automatic refund for merchant cancellation after activation, and deterministic unserved refund for platform termination.
- AUTO_3_DAYS is opt-in; default remains MANUAL_WITHDRAWAL.
- Centralized mode is owner-activated, never enabled automatically; historical merchant-direct orders remain legacy.

The older design/proposal/plan contain obsolete review-only labels and pre-007 counts. Their historical assertions must not be used as evidence that finance is implemented.

## Integration findings

- Platform PromptPay settings are currently stored through the integration resolver but explicitly report `wired_to_payment: false`.
- `payment-service.cjs` obtains the current merchant PromptPay identity for QR and verification. It does not pin a platform recipient version.
- Merchant recipient mapping is encrypted in Integration Settings with environment fallback and binds QR identity to the expected bank account.
- EasySlip validates amount, duplicate indication, matched account and raw receiver against the configured merchant mapping. Centralized implementation must retain these checks while resolving the pinned platform version.
- Existing AES-256-GCM and persistent integration key handling can be reused; no secret values were printed or changed.
- S3-compatible private object storage already exists. Mocked storage tests passed as part of the backend suite. No real S3, EasySlip or LINE request was made by this audit.
- Real provider credential verification remains CONFIG REQUIRED / NOT RUN, not a blocker for local mocked finance development.

## Verification executed

| Command/check | Result |
|---|---|
| `npm run start-db` | PASS; reused existing PostgreSQL |
| `npm run db:status --workspace backend` | PASS; 7 complete, 0 pending |
| `npm run db:verify-local --workspace backend` | PASS; 37 application tables |
| Read-only catalog audit | PASS; 39 public tables, finance absent |
| `node scripts/isolated-local-verification.cjs` with existing `LOCAL_PG_BIN` | PASS; backend 218/218, customer browsing, payment, promotion, Phase I and Admin smoke |
| Disposable-schema cleanup/public-data comparison | PASS; all 39 public tables unchanged |
| `node --test scripts/*.test.cjs` | PASS; 174/174 |
| `npm run lint` | PASS |
| `npm run build` | PASS; Next.js production build |
| `npm run security:scan` | PASS; no credential/runtime artifact findings |
| `npm audit --omit=dev` | PASS; 0 vulnerabilities |
| `git -c core.safecrlf=false diff --check` | PASS |
| New finance invariant tests / finance E2E | NOT RUN; implementation stopped before migration |
| Interactive browser finance QA | NOT RUN; finance UI does not exist |

The existing smoke flow exercises customer mock payment → manager acceptance → kitchen → rider completion through application APIs and the actual client cart helper. It is not a claim of a new interactive browser finance run.

## Resume point

Resolve only the Confirm Paid evidence/reference policy above, reconcile the proposal with the already approved sprint policies, then continue the authorized finance implementation from migration sequence 008. Preserve the locked UI and captured working tree; do not restart from scratch.

Current implementation statuses: centralized payment, GP ledger, wallets, withdrawals, payout workflow, partial-refund accounting, advertising billing and finance reconciliation are **NOT IMPLEMENTED**. Existing legacy payment flow passed regression.

Cloud: NOT DEPLOYED. Git: NOT COMMITTED / NOT PUSHED. No financial balances were seeded or fabricated.
