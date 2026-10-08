# Theo data audit (read-only, nothing changed)

This is a findings report, not a build plan. No code, database or settings were changed. Evidence comes from `supabase/functions/ai-assistant/index.ts` (2,824 lines) and live database row counts taken Oct 2, 2026, 01:40 UTC.

## The short version

1. **Theo's "today" is always Pacific time.** That is hardcoded at line 2336, so Coop's in Hayward, Wisconsin (Central time) gets the wrong day near midnight. None of Theo's tools use the 4 AM-style business-day cutover; they all use calendar midnight.
2. **Theo can't see today's labor.** He reads only the daily labor table, which holds closed days only. It had 0 rows for today when checked. The dashboard works out today's labor live from the time clock, so Theo and the dashboard disagree all day.
3. **Theo can count labor twice.** For stores that have both POS labor and time-clock labor on the same day, Theo gets back both rows and does not pick one. The dashboard uses the "Pull Qu Labor %" switch to choose.
4. **Theo values inventory using the retired pack field.** He still reads `pack_quantity_override` (lines 111-112, 1295, 1409) and never uses the per-store pack rule. He also ignores the pack size frozen at count time. So his COGS and count dollars can differ from the inventory screens.
5. **Theo's schedule answers include unpublished drafts.** His main schedule lookup never checks whether a schedule is published, but his call-out and punch-pattern tools do.
6. **Theo's training library is empty.** The resource list (`opus_resource_index`) has 0 rows. The learned-knowledge table last got a new entry on April 9, 2026.

## One row per tool

| Tool | Reads today | Status | Replacement | Freshness | Can disagree with | Gaps |
|---|---|---|---|---|---|---|
| query_sales | sales_cache (net, guests, projections, hourly, product mix). Can trigger a refresh to fill missing product-mix days | Current | none | Depends on each POS: QU live plus nightly, Clover and Aloha synced, Toast robot | Dashboard pace and goal: Theo picks override, then living, then initial, then projected. The dashboard follows a shift-aware projection order. Not verified identical | Toast has only 251 days of data. Product mix is uneven outside QU |
| query_labor | labor_cache, plus time_punches if asked | Mixed | get_live_labor_totals for today, get_labor_totals_for_dates for gap days | Closed days only, written nightly. Nothing for today | Dashboard and kiosk (live labor). Also double rows (qubeyond plus punch_clock) | Toast labor last day Sep 29. QU last Sep 26. Wages hidden below manager |
| query_labor_intelligence | labor_insights | Current | none | Nightly; newest Sep 30 | The insight text vs the live labor card | Only stores that ran the nightly job |
| query_schedule | scheduled_shifts joined to schedules | Mixed | should filter is_published, or use the published snapshot | Live | Team schedule view (published only) | Draft shifts get reported as real |
| query_availability | availability_requests | Current | none | Live | none found | none |
| query_shift_marketplace | shift_offers | Current | none | Live | Feed Shift Swaps bar (now includes claimed and approved) | Not checked whether Theo includes the same statuses |
| query_checklists | checklist_submissions (6,636 rows, live) | Mixed | dashboard uses checklist_items plus checklist_responses (79,807 rows) | Live | Dashboard completion %. A form "submitted" is not the same as items done, and Theo ignores the archive/swap rules (family_id, is_active per period) | Percent complete won't match the dashboard |
| query_tasks | temporary_tasks, subtasks, task_subtask_completions, alarm_task_completions | Current | none | Live | Dashboard task list. Uses calendar-midnight cutoff | Business-day cutover not applied |
| query_logbook | logbook_categories (active), logbook_entries | Current | none | Live | none found | none |
| query_inventory | inventory_counts, inventory_count_items, inventory_items, item_conversions, pfg_orders, pa_orders, sales_cache | Deprecated pack path | get_store_pack_lens / v_store_pack_lens, plus the count-time snapshot | Live counts | Inventory period panel and AvT report | COGS uses order totals, not invoices; weekly counts only. Lite inventory and transfers are ignored |
| query_punch_patterns | time_punches, schedules (published), scheduled_shifts, labor_cache | Mixed | _labor_pair_shifts / labor_shifts for pairing | Live punches | Payroll and labor screens, which pair shifts in one place | Time filter has no timezone offset (line 2010), so it treats the date as UTC |
| query_callout_patterns | schedules (published), scheduled_shifts, time_punches, availability_requests, labor_cache | Mixed | same as above | Live | Schedule and no-show views | Same UTC filter (line 1895) |
| query_crew_performance | time_punches, sales_cache, labor_cache | Mixed | labor RPCs | Live plus nightly | Labor intelligence grades | Same UTC filter (line 2155); today's labor missing |
| query_employee_notes | user_locations, employee_notes (5 rows, last Aug 31) | Current, barely used | none | Live | none | Almost empty |
| query_certifications | user_locations, certifications (55 rows) | Current | none | Live | none | The 180-day cutoff uses a UTC date (line 1587) |
| query_tips | daily_tips | Current | none | Daily; 12 stores | Tip distribution screen (not compared) | 6 stores have no tips |
| query_catering | catering_orders (7 rows, last Sep 8) | Current, barely used | none | Live | none | Almost empty |
| query_ovation_reviews | Ovation API (external) | Current | none | Live call, about a 5-minute cache in the app | App review card (different cache) | Only stores mapped to Ovation. Not deeply verified |
| query_store_hours | location_hours | Current | none | Live | none | Only 15 of 18 stores have hours |
| query_my_chats | chat_members, chats, messages | Current | none | Live | none | Not deeply verified |
| fetch_resource_content | location_integrations, opus_resource_index, theo_knowledge | Dead plus stale | none (the OPUS LMS is archived) | n/a | n/a | Resource list is empty; knowledge last added Apr 9 |

The opening data summary Theo sees (`buildContextSnapshot`, lines 190-260) reads sales_cache, labor_cache, scheduled_shifts (draft or published, no filter), daily_tips, location_hours and availability_requests. It works out the day of the week in Pacific time, so it has the same problems as the tools above.

## The seven suspicions

**a. Theo reads labor from the sales table: REFUTED.** sales_cache has no labor columns in the live database, and Theo reads only sales and projection columns from it (lines 201, 726, 1346, 2161).

**b. Theo's today labor matches the dashboard: CONFIRMED that it does NOT.** Theo reads only labor_cache (line 839) and never calls `get_live_labor_totals`. labor_cache had 0 rows for today; the dashboard and kiosk use the live total (`src/utils/liveLabor.ts`). So Theo shows no labor for today while the dashboard shows real dollars. He can also add up both the POS row and the time-clock row for a day, which roughly doubles it.

**c. Checklist completion: CONFIRMED mismatch.** Both tables are live: submissions had a new row Oct 1, responses had one Oct 2. The dashboard works out completion from `checklist_items` plus `checklist_responses` (`useChecklistCompletion.ts`, lines 53-76). Theo counts submitted forms instead (line 950). It also doesn't apply the archive or scheduled-swap scoring rules, so his completion percent can differ from the dashboard's.

**d. Old pack path: CONFIRMED.** Theo's own copy of the valuation math falls back to `pack_quantity_override` (lines 111-112) and asks for that field in its lookups (lines 1295, 1409). He never calls the per-store pack lookup. He also runs in "force live" mode, which ignores the pack size frozen at count time whenever live data is available (line 55).

**e. Schedules: PARTLY.** `scheduled_shifts` (joined to `schedules` for the store) is the right source. Call-out and punch-pattern tools filter for published schedules (lines 1874, 2019). But the main schedule tool and the opening summary don't, so drafts leak in. `family_id` is checklist-only; schedules don't have it, so it doesn't apply here.

**f. Rebuilt math that an existing function already does: CONFIRMED.** Places most likely to drift:
- Today's labor rebuilt from the labor table instead of `get_live_labor_totals` or `get_labor_totals_for_dates`.
- Shift pairing for punch, call-out and crew tools rebuilt by hand instead of the shared `_labor_pair_shifts`.
- Pack and valuation math copied into the file instead of using `get_store_pack_lens`.
- Business date worked out by hand instead of `business_date()` or `business_day_window()`.
- Checklist completion rebuilt from a different table.
- Projection pick order chosen in Theo, not taken from the shared projection module.

**g. Business-day cutover: CONFIRMED that it is NOT used.**
- Timezone is fixed to Pacific (line 2336).
- The offset is taken from "right now", so date ranges that cross a daylight-saving change are off by an hour (line 147).
- Punch tools use calendar midnight with no offset at all, so they count from midnight UTC (5 PM Pacific the day before) (lines 1895, 2010, 2155).
- The week end date (line 196) and the certification cutoff (line 1587) use UTC dates.
- The 4 AM cutover is never applied, so after-midnight closing punches fall on the wrong day.

## Tables Theo reads that are empty or no longer updated

- opus_resource_index: 0 rows (LMS archived).
- theo_knowledge: 457 rows, newest Apr 9, 2026.
- employee_notes: 5 rows, newest Aug 31.
- catering_orders: 7 rows, newest Sep 8.
- labor_cache by source:
  - Toast: 2 rows, last Sep 29.
  - QU: 156 rows, last Sep 26.
  - Aloha: 463 rows, last Oct 1.
  - Time clock: 3,777 rows, last Sep 30.
- Everything else Theo reads has rows written within the last day.

## Areas the app has that Theo can't see

- Daily briefings Theo already wrote (`croo_ai_briefings`, 2,827 rows).
- Activity feed and announcements.
- Write-ups and performance reviews (may be intentional for privacy).
- Hiring: applications, interviews, job listings.
- Lite inventory, transfers, waste logs, spot counts.
- Vendor invoices (PFG and Produce Alliance); his COGS uses order totals instead.
- Recipes and menu pricing (Menu Genius).
- Payroll export and pay periods.
- Deposits and cash (deposits are logbook entries; `croo_cash_transactions` was the retired Croo Cash points ledger, not cash).
- Food safety audits, QR task reports, holidays and events.
- Toast shifts table (read-only Toast punches) for Coop's.

## Not verified

- Whether Theo's projection pick order matches the dashboard's number exactly.
- Ovation and chat tools beyond what they read.
- Shift-marketplace status filter.
- Tip numbers against the tip screen.
- psql cannot run database functions, so the definitions of `get_live_labor_totals` and the pack-lens functions were not compared line by line.
