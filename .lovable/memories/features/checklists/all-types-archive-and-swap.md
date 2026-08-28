---
name: Checklists — all types archive + duplicate/swap
description: Aug 28 2026 correction: archive and duplicate/scheduled swap apply to daily, weekly/dynamic, monthly and training; live-now allowed on every type
type: feature
---

Jordan, Aug 28 2026 — lifts the earlier weekly-dynamic-only restriction.

- Archive (`checklist_items.deleted_at`) applies on EVERY checklist editor. `EditChecklist` no longer hard-deletes removed items — it stamps `deleted_at` and only loads `deleted_at IS NULL`.
- Confirm/save copy names the right period: daily → "today / starting tomorrow", weekly → "this week / starting Monday", monthly → "this month / starting the 1st". Helper: `archivePeriodCopy` in `src/utils/checklistVersions.ts`.
- `canGoLiveNow` is now true for all types — live-now is an override on daily, weekly and monthly.
- Duplicate & Schedule is offered on standard AND training templates. Default schedule = next period open for that type.
- Overdue push coverage: daily + dynamic stay in `check_alerts_sql`; monthly has its own loop there; plain weekly lists are handled by `check_weekly_checklist_alerts_sql()` (cron `check-weekly-checklist-alerts`, every 5 min, fires only on Sunday after `due_by_time`, week window from Monday, `deleted_at IS NULL`, family-based dedup + 59-min guard).
- Copy-to-another-location stays a separate action; never merged with duplicate.
