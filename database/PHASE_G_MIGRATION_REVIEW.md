# Phase G additive migration proposal (before implementation)

005 adds only merchant_opening_hours: id PK, merchant_id FK merchants, day_of_week 0–6,
open_time, close_time, is_closed, created_at, updated_at. UNIQUE merchant/day.
CHECK closed or close_time > open_time. Closed days may have NULL times.
Needed for weekly schedules; merchants.is_open remains the manual switch. No schedule
means existing behavior. Bangkok timezone. Overnight opening is deliberately unsupported.
Rollback drops only this new table; no edits to 001–004 or historical order snapshots.
No manual override column is needed. Existing is_open=false always means manually closed.

PromptPay changes are blocked while nonterminal unpaid orders exist. No payment logic changes.
Stock remains manual; decrement/reservation needs a separate Phase H transaction design.
