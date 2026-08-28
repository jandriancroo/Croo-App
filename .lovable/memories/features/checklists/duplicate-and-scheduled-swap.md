---
name: Checklist Duplicate & Scheduled Swap
description: family_id versioning, draft/superseded/activation semantics, Monday-or-1st-only swaps, and closed-period reporting that ignores is_active
type: feature
---

LOCKED (Jordan + Ryan, Aug 28 2026).

## Fields on `checklists`
- `is_active` = GM kill switch ONLY (season off / turned off on purpose). Never overloaded for versioning.
- `family_id` — groups every version of the same list. Stamped once, NEVER changed. Backfilled to `id` for all pre-existing rows.
- `replaces_checklist_id` — ordering only; never walked in queries.
- `superseded_at` — set on the source when a swap turned it off as the old version.
- `activation_at` — scheduled go-live at that location's next period open.

States: pending draft = `is_active false AND superseded_at IS NULL AND replaces_checklist_id IS NOT NULL`.
After swap: draft `is_active true, activation_at NULL`; source `is_active false, superseded_at = now()`.

## RPCs
- `duplicate_checklist_as_draft(_source_id, _activation_at)` — copies title/settings/items/day tags/shifts/options/role tags/user tags. Only ONE draft per family: duplicating again DELETES the existing draft first.
- `perform_checklist_swap(_draft_id)` — one transaction, draft on + source off together. NO-OPs (and clears activation_at) when the source was manually turned off since the draft was made — a seasonal disable must never come back on.
- `run_due_checklist_swaps()` — cron `run-checklist-swaps` at `2 * * * *`, deliberately before the 11:05 UTC digest queue. Revoked from anon/authenticated.

## Query rules
- Crew / live floor / overdue: `is_active = true AND superseded_at IS NULL`.
- Closed-period reporting (digest, heatmap, history %): select every version, IGNORE `is_active`, keep a version if it is current or `superseded_at >= period_start`; drop pending drafts. Helper: `wasLiveDuringPeriod` in `src/utils/checklistVersions.ts` (mirrored in support-email-service).
- Overdue dedup + the 59-minute log guard key off `family_id`, not checklist id, so swap morning never double-pings.
- Never rewrite `checklist_id` on old submissions; never map old responses onto new item ids.

## Schedule UI rules
Weekly/dynamic → Mondays only at business open. Monthly → the 1st. Daily → next business open, and daily is the ONLY type allowed a live-now override (weekly/monthly would split a period across two ids).
