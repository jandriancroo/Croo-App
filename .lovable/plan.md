# Labor projection (labor pace) — STEP 0 report only

Nothing has been built or changed. This is the report. Waiting for "go".

## 1. Where the pieces live today (all server-side unless noted)

| Piece | Where | Server? |
|---|---|---|
| Hours worked so far, per person, breaks applied | `_labor_pair_shifts` (pairs punches, applies `labor_rules.unpaid_break_min_minutes`, default 30; already returns `estimated_end` / `estimated` for open shifts), summed by `labor_day_user_totals(_location_id, _date, _live)` | Yes |
| Wage per person | Inside `labor_day_user_totals`: latest `wage_history.hourly_wage` on or before the date, else `profiles.hourly_wage`; returns `wage_missing` | Yes |
| Store total + source (Qu vs time clock) | `_store_labor` → `get_store_labor`; source picked by `labor_source_for`; access gate `_labor_totals_authorized` | Yes |
| Business date / window | `business_date`, `business_day_window`; old-vs-new rule split by `labor_new_rule_start()`; Virginia St kept on the legacy copies (`_legacy_*`) | Yes |
| Today's scheduled shifts | `scheduled_shifts` table (includes phantom rows `is_phantom=true` made at clock-in) | Data only, no projection function |
| End-of-day sales projection | Goal pick override > living > initial > legacy is `_resolve_goal` (server) and `resolveGoalWithSource` in `_shared/cubeMetrics.ts`. The live Dash pace (actual + remaining goal) is worked out in the app (`periodMetrics.ts` / SalesSummary) | Goal: yes. Live pace: app-side today |
| Store labor goal % | `labor_goals(_location_id)` RPC (read by `useLaborGoals`) | Yes |

Gap to flag: the Dash sales pace number itself is not a server function yet. The projection needs a server version of it (same formula as the shared `periodMetrics` pace), not a copy of app code.

## 2. Proposed shape

One new function: `get_labor_projection(_location_id uuid, _date date default business today)`. Security definer, same `_labor_totals_authorized` gate, same source switch.

Returns one row (jsonb or table + a per-person json array):

- `business_date`, `as_of`, `source` ('punch_clock' | 'qubeyond' | 'toast'), `mode` ('live' | 'schedule_only' | 'unavailable')
- `worked_hours`, `worked_labor_dollars` (equal to today's `labor_day_user_totals` sum — reused, not recomputed)
- `remaining_scheduled_hours`, `remaining_labor_dollars`
- `projected_hours`, `projected_labor_dollars`
- `projected_sales`, `projected_sales_source` (override / living / initial / pace)
- `projected_labor_pct` (null when sales null or 0 — never 0)
- `target_labor_pct`, `target_labor_dollars`, `variance_pct`, `variance_dollars`, `status` ('ahead' | 'on_track' | 'behind' | null)
- `saved_late_minutes`, `saved_early_minutes`, `wage_missing_count`, `unscheduled_count`, `no_show_count`
- `people[]`: user_id, name, wage, wage_missing, scheduled_start/end, actual_in/out, on_break, worked_hours, remaining_hours, late_minutes, early_out_minutes, state ('working' | 'done' | 'not_started' | 'late_not_in' | 'unscheduled' | 'over_schedule')

One app hook: `useLaborProjection(locationId, businessToday)` — plain read of the function, no math, shows "—" on error or null.

## 3. Edge cases — proposed answers

- **Shift started, not clocked in (late / no-show):** count from now until scheduled end (assume they're on their way). After a grace window (proposal: 60 min past start, or scheduled end passed) count nothing and mark `no_show`. Saved minutes shown as late.
- **Clocked in, no scheduled shift:** use the same `estimated_end` `_labor_pair_shifts` already produces (the phantom shift = clock-in + 8h). Flag `unscheduled`.
- **Still clocked in after scheduled end:** count until now only (no more future hours); flag `over_schedule`. Pace grows minute by minute as they stay.
- **On break now:** future hours continue from break end at scheduled end; the unpaid-break rule handled by the existing pairing. If a scheduled unpaid break hasn't been taken yet, subtract it from remaining time using the same rule (shift long enough → break minutes off).
- **Split / two shifts:** each scheduled shift handled on its own, matched to punches by `shift_id` (already kept on punches); unmatched punches fall back to time overlap.
- **Overnight:** use `business_day_window` for the day; a shift belongs to the business date it starts in, consistent with the existing pairing.
- **No hourly wage (salaried / shift managers):** hours counted, dollars use the existing fallback exactly as today's labor number does; `wage_missing_count` reported so screens can say so. No new wage rule.
- **Before `labor_new_rule_start()` and Virginia St:** return `mode = 'unavailable'` (projection only makes sense for live today; Virginia St stays on legacy until moved). No legacy projection.

## 4. Qu and Toast stores

- **Qu ("Pull Qu Labor %" on):** Qu gives a store total, not per-person live punches, so worked-so-far per person isn't available. Proposal: worked = latest Qu labor for today, remaining = schedule from now, `mode = 'live'` with source 'qubeyond' — or hide if the Qu number is older than ~30 min. Need to confirm Qu refresh timing before building.
- **Toast (Coop's Hayward):** punches come from the robot (`toast_shifts`), typically minutes to tens of minutes behind. Proposal: use them when last sync is under 30 min old, else `schedule_only` with a "schedule only" label. Hayward uses America/Chicago.

## 5. Performance

Light: one store, one day, a few dozen punches and shifts. Dash can poll every 60s while visible (same as `useStoreLabor`). No cache table needed; no shared cache (keeps permission-sensitive labor per caller).

## 6. Tests (SQL test cases + small TS check on the hook's display)

- On time, working now → counts to scheduled end
- Late in → actual start to scheduled end; late minutes saved
- Early out → no more hours; early minutes saved
- Not started yet → full shift
- Late not in, inside grace → now to end; past grace → 0, no_show
- Unscheduled clock-in → estimated_end
- Over schedule → counts to now only
- On break now; unpaid break not yet taken
- Split shift (two shifts) and overnight shift
- Missing wage → flagged, matches existing labor dollars
- worked_hours equals today's `labor_day_user_totals` sum exactly
- Sales null/0 → pct null (never 0)
- Pre-new-rule date and Virginia St → unavailable
- Unauthorized caller → nothing returned
- Toast stale sync → schedule_only

## 7. Confirmation

Additive only: one new function, one new hook, tests. No change to `labor_day_user_totals`, `labor_day_totals`, `get_store_labor`, labor-service, backfill_labor, the Dash, cubes, Theo, Watch, or any locked file.

## Decisions needed before "go"

1. No-show grace window (60 min proposed).
2. Qu stores: use Qu total + schedule, or hide?
3. Server sales pace: OK to add a server version of the Dash pace formula as part of this?
