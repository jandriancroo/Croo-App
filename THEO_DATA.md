# THEO_DATA.md — where Theo's answers come from

Last updated: 2026-10-01. Owner: Jordan. Written by Claude from a read-only audit by Lovable (saved at `.lovable/plan/theo-data-audit-read-only-nothing-changed-2026-10-02.md`) plus Claude's own read of `supabase/functions/ai-assistant/index.ts`.

## How to use this file

- This is the map of what Theo knows and how far to trust it. It is the companion to `THEO_ABILITIES.md` (what Theo can do).
- Claude edits this file. Lovable builds from it and updates a row's Status only when a build changes it. Jordan approves changes.
- Before any Theo build, check the area's row here. If the row says the source is wrong, fix the source first.
- Inventory is out of scope for Theo for now. See `THEO_INVENTORY.md`. The one exception is item sales (top items and the promo tracker), which is sales data and stays in play.

## The rule: one number, one path

If a screen in the app shows a number, Theo must get that number from the same function the screen uses. Theo never rebuilds a calculation that an existing function already does. Every mismatch found in the audit came from Theo doing his own math beside the app's.

## Rules that apply to every area

| Rule | What it means | Where it lives | Theo today |
|---|---|---|---|
| Location time zone | Every date and time is in the store's own time zone | `location_settings.timezone` (the app reads it in `useLocationTimezone`) | OK (Round 1): read from `location_settings.timezone` per request, Pacific only if a store has none |
| Business day | A store's "day" starts at its morning cutover, not at midnight, so late closing punches belong to the day that just ended | `business_date(_location_id, _at)` and `business_day_window(_location_id, _date)` | OK (Round 1): "today" comes from `business_date`; punch, checklist and task day filters use `business_day_window`; punches are assigned to their business date |
| Published vs draft | Crew-facing answers use published schedules only | `schedules.is_published` | OK (Round 1): every schedule read filters published; no published week returns a marker (managers also get the draft count) |
| Role privacy | Wages and per-person pay only for manager and above | role check in `ai-assistant` | OK |

## Data areas (inventory excluded)

Status key: OK = Theo reads the right place. FIX = Theo reads the wrong place or does his own math. NEW = the app has it and Theo has no way to see it. "Audit" means reported by Lovable and not re-checked by Claude.

| Area | Where it shows in the app | Source of truth | What Theo reads today | Status | Correction |
|---|---|---|---|---|---|
| Sales (net, guests, avg ticket, hourly) | Dashboard Sales Summary, Today / Week / Month | `sales_cache` | `sales_cache` | OK | None. Freshness depends on the store's POS feed |
| Sales goal and pace | Sales Summary orange box (Goal, Pace) | `sales_cache` projections through the shared projection order in `supabase/functions/_shared/projections.ts` | Picks override, then living, then initial, then projected, in his own order | FIX (unverified) | Confirm Theo's goal equals the dashboard's for the same day; if not, use the shared order |
| Comparisons (vs last week, vs last year) | Sales Summary chips and Last Year | `get_sales_comparisons` RPC (dashboard) | Not used | NEW | Give Theo the same RPC. QU stores only have prior-period comparison today; Toast and Clover have none |
| Top items (units, dollars) | Sales Summary "Top 20 Products by Sales" | `sales_cache.product_mix` | `sales_cache.product_mix` via `query_sales` (top 50) | OK | None. Coverage is uneven outside QU stores (audit) |
| Promo tracker (store rankings, units, dollars, P-mix per item) | Dashboard promo tracker widget (`TrackerWidget.tsx`) | `get_tracker_ranking` RPC | Nothing | NEW | Add a tool that calls `get_tracker_ranking` |
| Labor (today and past days) | Sales Summary Labor % tab, dock, schedule labor totals, reports | `get_store_labor(_location_ids, _start, _end)` via `fetchStoreLabor` (`src/hooks/useStoreLabor.ts`); today is live; checks the signed-in user's role and store access | `get_store_labor` called as the signed-in manager, for `query_labor`, `query_crew_performance` and the opening summary (labor fetched per request, outside the cached summary). `labor_cache` read only for the per-employee breakdown, matching the source `get_store_labor` used | OK (Round 1) | None. If the call is refused, Theo says he can't see labor; no `labor_cache` fallback |
| Labor insights and grade | Morning brief, Time Tracking Theo line | `labor_insights` (nightly) | `labor_insights` | OK | Say "no labor data for that day" instead of 0% or grade F when the feed is missing |
| Schedule (who works when) | Schedule page, team schedule view | `scheduled_shifts` joined to `schedules`, published only | Same tables, `schedules.is_published = true` in `query_schedule` and the opening summary | OK (Round 1) | None |
| Availability and time off | Schedule page | `availability_requests` | `availability_requests` | OK | None |
| Shift marketplace | Activity feed, marketplace | `shift_offers` | `shift_offers` | OK (status filter unverified) | Confirm Theo includes the same statuses as the feed |
| Checklist completion | Dashboard Checklists card | `checklist_items` + `checklist_responses`, scored in `useChecklistCompletion.ts` (business-day window, archive rules) | `checklist_submissions` (counts submitted forms) | FIX | Report completed vs expected items the way the dashboard does |
| Tasks | Dashboard Quick Tasks | `temporary_tasks` and related tables | Same | OK | Apply the business-day window |
| Punches, lateness, call-outs, crew performance | Time Tracking, labor screens | Shift pairing in `_labor_pair_shifts` | Rebuilds pairing by hand; date filters have no time zone offset | FIX | Use the shared pairing and the business-day window |
| Logbook | Logbook | `logbook_entries`, `logbook_categories` | Same | OK | None |
| Tips | Tip distribution screen | `daily_tips` | `daily_tips` | OK (totals unverified) | None. 6 stores have no tips (audit) |
| Guest reviews | Ovation review card | Ovation API | Ovation API | OK | Only stores mapped to Ovation |
| Store hours | Settings | `location_hours` | `location_hours` | OK | 15 of 18 stores have hours (audit) |
| Certifications | Employee records | `certifications` | `certifications` | OK | Cutoff date uses UTC; move to store date |
| Employee notes, catering | Employee records, catering | `employee_notes`, `catering_orders` | Same | OK but nearly empty | 5 and 7 rows (audit). Theo should not imply he has history here |
| Training library | n/a | `opus_resource_index` | `opus_resource_index` | DEAD | 0 rows; the LMS is archived (audit). Stop offering the tool or re-point it |
| Pinned knowledge | Theo chat (Pin) | `theo_knowledge` | `theo_knowledge` | OK but stale | Newest entry Apr 9, 2026 (audit) |

## What Theo cannot see yet (non-inventory)

In rough priority order for a manager's day:

1. Cash and deposits (`croo_cash_transactions`, drawer counts). Needed for the cash-variance questions Jordan demos.
2. His own past briefings (`croo_ai_briefings`), so he can answer "what did you tell me this morning".
3. Promo tracker rankings (see table above).
4. Sales comparisons (see table above).
5. Temperature and food-safety logs beyond what checklists hold.
6. Activity feed and announcements.
7. Coop's Toast shifts (read-only Toast punches).
8. Hiring, write-ups and reviews, payroll: leave out unless Jordan decides otherwise (privacy).

## What Theo says when data is missing

- No labor feed for the day: "I don't have labor data for [day] yet, so I'll skip labor." Never "0%" and never a grade.
- No published schedule: "There's no published schedule for that week." For managers, add how many draft shifts exist.
- No prior-period comparison for the store's POS: say the comparison isn't available for this store; do not show 0%.
- Empty tables (notes, catering, training): "I don't have anything recorded for that."
- Inventory, counts, food cost, ordering: "Inventory isn't something I can help with yet."

## Not verified

- Whether Theo's sales goal matches the dashboard's exactly.
- Tip totals against the tip screen.
- The shift-marketplace status filter.
- The labor RPCs line by line (Lovable's database access could not run them).

## Change log

- 2026-10-01: First version from the read-only audit. Inventory moved to `THEO_INVENTORY.md`.
- 2026-10-01: Round 1 gate corrected the labor source to get_store_labor and the time zone source to location_settings.
- 2026-10-02: Round 1 built in `ai-assistant`: store time zone and business date, business-day windows, published-only schedules, labor from `get_store_labor` as the signed-in user, inventory tool switched off.
