# THEO_DATA.md — where Theo's answers come from

Last updated: 2026-10-05. Owner: Jordan. Written by Claude from a read-only audit by Lovable (saved at `.lovable/plan/theo-data-audit-read-only-nothing-changed-2026-10-02.md`) plus Claude's own read of `supabase/functions/ai-assistant/index.ts`.

## How to use this file

- This is the map of what Theo knows and how far to trust it. It is the companion to `THEO_ABILITIES.md` (what Theo can do).
- `THEO_ABILITIES.md` is referenced but does not exist in the repo yet. Until it does, Theo's actions are summarized in "What Theo can do today" below.
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
| Local times and weekdays | Every time and date a manager reads is store-local with its weekday | every tool result | Every UTC timestamp in a tool result gets a `*_local` twin ("Thu Oct 1, 8:04 PM"), every date a `*_weekday`; the opening summary and system prompt show weekdays | OK (2026-10-02) | None |
| Role privacy | Wages and per-person pay only for manager and above | role check in `ai-assistant` | OK |

## What Theo can do today (actions)

All actions below are available in typed chat and voice. "Managers and up" means only `manager`, `admin`, `org_admin` and `super_admin`, AND `has_location_access` for this store. Shift managers, shift managers in training, team members and brand admins get no actions.

Theo only builds a preview card. Nothing saves until the manager taps that card's save button; saying "yes" does not save. The tap is rechecked, `cancel_pending_action` drops an open preview, and the wizard logs previews and saved actions in `theo_action_log`.

| Action | Who (role) | How it saves | Notes |
|---|---|---|---|
| `create_task` (quick task) | Managers and up, with store access | Preview → tap Create task → recheck → shared quick-task save | Standard quick task for a person or role |
| `create_event` | Managers and up, with store access | Preview → tap Add event → recheck → shared event save | One-time or recurring; categories, notes, role tags, daily-task and meeting flags. Creating a new category requires admin or above; managers can use existing categories |
| `cover_shift` | Managers and up, with store access | Preview → tap Confirm change → recheck → shared schedule save | Checked cover candidates; published weeks also run Update |
| `add_shift` | Managers and up, with store access | Preview → tap Add shift → recheck → shared schedule save | Checked day preview; a new week starts as a draft |
| `delete_shift` | Managers and up, with store access | Preview → tap Delete shift → recheck → shared schedule save | Refuses protected shifts; published weeks also run Update |
| `swap_shift` | Managers and up, with store access | Preview → tap Swap shifts → recheck → shared schedule save | Checks both shifts and people |
| `change_shift` | Managers and up, with store access | Preview → tap Change hours → recheck → shared schedule save | Checks the changed hours and conflicts |
| `send_message` (reply / new DM, build 6A) | Managers and up, with store access | Preview → tap Send → recheck → `src/lib/chatMessages.ts` | Replies can quote a message; new DMs reuse an existing DM; sensitive pay/discipline topics are blocked |
| `clock_punch` (build 6C) | Managers and up, with store access | Preview → tap Confirm → recheck → shared punch save; Undo available | Clock ONE named crew member in or out at this store, e.g. "clock in Cheyenne at 8:30"; never crew self clock-in through Theo |

For `clock_punch`, Theo checks the person's punches, scheduled shift and meetings using `_shared/punchPlan.ts`, and shows the real clock-in time when clocking out. Only the manager's Confirm tap writes the punch. No scheduled shift is a plain warning that confirming also adds a placeholder shift; Undo removes it only when verified safe. The separate QuickPunchDialog in Schedule/Time Clock is the manager's manual quick-punch screen, not Theo.

Voice uses the same `ask_theo` lookups and the same actions as typed chat. `theo-voice` must never claim it saved something; it tells the manager to "tap ... to save".

Read-only tools also offered today that the data table does not list by name: `query_my_chats`, `find_chats` and `read_chat` (managers only, only chats the asking person belongs to, scoped to this store; no hiring or support chats), `query_labor_intelligence`, `query_callout_patterns`, `find_crew`, `find_shifts` and `cover_candidates`. Shift managers can still ask who is working; that is a read, not an action.

Source of truth: `_shared/theoActions.ts` (`actionsFor` / `theoActionsAt`), `supabase/functions/ai-assistant/{index,cover,shifts,events,messages,punches}.ts`, `src/components/ai/theoWizard.tsx` and `supabase/functions/theo-voice/index.ts`.

- **quick_nudge** — Nudge everyone on the clock about a checklist, task or event (manager+, incl. brand admins; voice + chat). Theo previews; the Send nudge tap sends through `quick-nudge` (via `src/lib/quickNudges.ts`) to everyone on the clock at the store, minus the sender and anyone nudged about that item in the last hour. Rules in `_shared/nudgePlan.ts` + `checklist_nudge_status` / `task_nudge_status` / `event_nudge_status`; log in `nudge_log`. No Undo.

## What people see after Theo acts (push taps, as of 2026-10-05)

Push-tap routing lives in `src/lib/pushRouting.ts` and its matching copy in `public/sw-push.js`. These rules also apply to pushes from the rest of the app, not just Theo.

- Theo sends a message → the recipient's push opens that DM (or the group chat for a group reply). Chats refresh when the app opens or comes back to the front, so the new message shows without force-quitting.
- Team Feed / announcement push → opens Chats, scrolled to that post with a brief highlight. Feed pushes now carry a link to the post, added in `send-push-notification`. If the post is unavailable after the refresh, the feed stays open without an error.
- Checklist pushes (overdue, monthly, training approvals) → open the dashboard only, never the checklist itself (Jordan's call).
- Exception: a manager's nudge (`quick_nudge`) about a checklist opens that checklist (`/complete/<id>`).
- A task nudge or event heads-up opens the dashboard alert card (`/?alert=<notification_id>`); its button opens the task (`/dashboard?task=<id>`) or highlights the event (`/dashboard?event=<id>`).
- Hiring: new application → Hiring page; interview reply → that applicant's hiring chat. Hiring chat messages are unchanged.
- Quick task pushes → dashboard alert card (unchanged). Schedule pushes (published / updated / shift approval / reminder) → just open or resume the app, with no deep link. Late arrival → Alerts.
- The native App Store app gets this tap routing only after its next rebuild. The home-screen web app gets it from the published web update; this source review alone does not verify what is currently published.

## Data areas (inventory excluded)

Status key: OK = Theo reads the right place. FIX = Theo reads the wrong place or does his own math. NEW = the app has it and Theo has no way to see it. "Audit" means reported by Lovable and not re-checked by Claude.

| Area | Where it shows in the app | Source of truth | What Theo reads today | Status | Correction |
|---|---|---|---|---|---|
| Sales (net, guests, avg ticket, hourly) | Dashboard Sales Summary, Today / Week / Month | `sales_cache` | `sales_cache` | OK | None. Freshness depends on the store's POS feed |
| Sales goal and pace | Sales Summary orange box (Goal, Pace) | Goal: `sales_cache` override → living → initial → projected_sales (same order as `resolveProjection`). Pace: `sales_cache.pace_adjusted_projection`, shown as max(pace, sales so far) | Goal in the same order as `resolveProjection` (confirmed); pace from `pace_adjusted_projection` with the dashboard's ahead/on track/behind thresholds; week pace = past actuals + today's pace + remaining goals | FIXED | Confirm Theo's goal equals the dashboard's for the same day; if not, use the shared order |
| Comparisons (vs last week, vs last year) | Sales Summary chips and Last Year | `get_sales_comparisons` RPC (dashboard) | Not used | NEW | Give Theo the same RPC. QU stores only have prior-period comparison today; Toast and Clover have none |
| Top items (units, dollars) | Sales Summary "Top 20 Products by Sales" (net sales, highest first, no filter) | `sales_cache.product_mix` | `sales_cache.product_mix` via `query_sales`, ranked by net sales like the dashboard (top 50), each item flagged `price_zero` when it sold for $0 (free add-ons/modifiers) | OK (2026-10-02) | None. Coverage is uneven outside QU stores (audit) |
| Promo tracker (store rankings, units, dollars, P-mix per item) | Dashboard promo tracker widget (`TrackerWidget.tsx`) | `get_tracker_ranking` RPC | Nothing | NEW | Add a tool that calls `get_tracker_ranking` |
| Labor (today and past days) | Sales Summary Labor % tab, dock, schedule labor totals, reports | `get_store_labor(_location_ids, _start, _end)` via `fetchStoreLabor` (`src/hooks/useStoreLabor.ts`); today is live; checks the signed-in user's role and store access | `get_store_labor` called as the signed-in manager, for `query_labor`, `query_crew_performance` and the opening summary (labor fetched per request, outside the cached summary). `labor_cache` read only for the per-employee breakdown, matching the source `get_store_labor` used | OK (Round 1) | None. If the call is refused, Theo says he can't see labor; no `labor_cache` fallback |
| Labor insights and grade | Morning brief, Time Tracking Theo line | `labor_insights` (nightly) | `labor_insights` | OK | Say "no labor data for that day" instead of 0% or grade F when the feed is missing |
| Schedule (who works when) | Schedule page, team schedule view | `scheduled_shifts` joined to `schedules`, published only | Same tables, `schedules.is_published = true` in `query_schedule` and the opening summary | OK (Round 1) | None |
| Availability and time off | Schedule page | `availability_requests` | `availability_requests`, with `pending_total`, `pending_upcoming`, `pending_past_dated` for the whole store and `showing X of Y` on the list | OK (2026-10-02) | None |
| Shift marketplace | Activity feed, marketplace | `shift_offers` | `shift_offers` | OK (status filter unverified) | Confirm Theo includes the same statuses as the feed |
| Checklist completion | Dashboard Checklists card | `checklist_items` + `checklist_responses`, scored in `useChecklistCompletion.ts` (business-day window, archive rules) | `checklist_submissions` (counts submitted forms) | FIX | Report completed vs expected items the way the dashboard does |
| Tasks | Dashboard Quick Tasks | `temporary_tasks` and related tables | Same | OK | Apply the business-day window |
| Punches, lateness, call-outs, crew performance | Time Tracking, labor screens | Shift pairing in `_labor_pair_shifts` | Business-day windows (Round 1). Lateness: `query_punch_patterns` returns per person per day scheduled start, first clock-in, minutes late and a `late` flag (7-minute grace), plus `late_count`; the model never judges lateness. Pairing still rebuilt by hand | FIX (pairing) | Use the shared pairing. As of commit `9948aa6` (Oct 5), Time Tracking, pay-period cards and personal pay use ONE helper, `src/utils/payrollDayBucketing.ts`, that mirrors `_labor_pair_shifts` + `business_date`: split and overnight shifts are filed under each shift's clock-in business day; duplicate clock-ins within 5 minutes are ignored (a clock-in ending a break is not a duplicate). Server `payroll_hours` remains the source of truth for paid hours. Theo still groups punches by hand, by shift ID or person/business day, so it can disagree with these screens on split/overnight shifts. It is the remaining separate pairing path among those compared here, not a verified claim about every screen in the app |
| Logbook | Logbook | `logbook_entries`, `logbook_categories` | Same | OK | None |
| Tips | Tip distribution screen | `daily_tips` | `daily_tips` | OK (totals unverified) | None. 6 stores have no tips (audit) |
| Guest reviews | Ovation review card | Ovation API | Ovation API, filtered to the asked window by store-local date; returns a `summary` (window start/end, review count, average rating) the model quotes, never recounts | OK (2026-10-02) | Only stores mapped to Ovation |
| Store hours | Settings | `location_hours` | `location_hours` | OK | 15 of 18 stores have hours (audit) |
| Certifications | Employee records | `certifications` | `certifications` | OK | Cutoff date uses UTC; move to store date |
| Employee notes, catering | Employee records, catering | `employee_notes`, `catering_orders` | Same | OK but nearly empty | 5 and 7 rows (audit). Theo should not imply he has history here |
| Training library | n/a | `opus_resource_index` | `opus_resource_index` | DEAD | 0 rows; the LMS is archived (audit). `fetch_resource_content` is still offered to the model today; only `query_inventory` is filtered out of `THEO_TOOLS`. Stop offering the training tool or re-point it — still open |
| Pinned knowledge | Theo chat (Pin) | `theo_knowledge` | `theo_knowledge` | OK but stale | Newest entry Apr 9, 2026 (audit) |

## What Theo cannot see yet (non-inventory)

In rough priority order for a manager's day:

1. Deposit reconciliation (deposits are logbook entries; `croo_cash_transactions` was the retired Croo Cash points ledger, not cash). Drawer and safe counts ARE readable through `query_logbook` (Drawer Count / Safe Count entries); the missing part is the cash transactions and deposit reconciliation needed for Jordan's cash-variance questions.
2. His own past briefings (`croo_ai_briefings`), so he can answer "what did you tell me this morning".
3. Promo tracker rankings (see table above).
4. Sales comparisons (see table above).
5. Temperature and food-safety logs beyond what checklists hold.
6. Team Feed posts (`announcement_posts`). Old-style announcement chats are searchable through `query_my_chats` for managers, within the same membership and store checks.
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
- 2026-10-07: Quick Nudge now covers tasks and events too (action renamed quick_nudge; function quick-nudge; log nudge_log).
- 2026-10-07: Quick Nudge v1 (checklists only): nudge_checklist action, dashboard nudge badge + sheet, Settings > Nudge Templates, checklist_nudge push opens the checklist.

- 2026-10-01: First version from the read-only audit. Inventory moved to `THEO_INVENTORY.md`.
- 2026-10-01: Round 1 gate corrected the labor source to get_store_labor and the time zone source to location_settings.
- 2026-10-02: Round 1 built in `ai-assistant`: store time zone and business date, business-day windows, published-only schedules, labor from `get_store_labor` as the signed-in user, inventory tool switched off.
- 2026-10-02: Pace now comes from `sales_cache.pace_adjusted_projection` (never the goal) with the dashboard's status thresholds, today and week.
- 2026-10-02: Lookup fixes from the model bake-off: local times and weekdays on every tool result, lateness flag in `query_punch_patterns`, time-off counts, a review summary for the asked window, top items in the dashboard's net-sales order with `price_zero`.
- 2026-10-05: Doc review against code (Ryan): added actions summary (incl. clock_punch build 6C), push-tap routing, 9948aa6 Time Tracking day bucketing note; training-library tool still offered; drawer/safe counts via logbook.
