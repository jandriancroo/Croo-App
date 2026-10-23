# THEO_ABILITIES.md — what Theo can do

Last updated: 2026-10-14. Owner: Jordan. Companion to `THEO_DATA.md` (the brain: where answers come from). This file is the hands: previews, save taps and their limits, checked against the current code.

## One preview, one tap, one save path

Typed chat and voice use the same action permissions and the same preview wizard, `src/components/ai/theoWizard.tsx`. Theo proposes; the manager taps to save. Saying “yes” is not a save. Voice sends store-data questions through `ask_theo` to `ai-assistant` and must never claim an unsaved preview was saved. `cancel_pending_action` dismisses the pending preview without saving.

Permissions come only from `supabase/functions/_shared/theoActions.ts` (`highestRole`, `actionsFor`, `theoActionsAt`). In this document **Managers and up** means exactly `manager`, `admin`, `org_admin`, `super_admin`, plus `has_location_access` for the store. Multiple role rows resolve to the highest app role. Shift managers, trainees and team members get no actions; brand admins get only Quick Nudge, with store access. Asking a read question does not grant an action.

Previews and outcomes are recorded in `theo_action_log`. Save buttons disable while saving. Most actions have an explicit server recheck at the tap; Quick Nudge rechecks in its send function. Quick-task creation is the exception: it uses the shared client save and database permissions, not a separate `ai-assistant` recheck. Undo is offered for 10 minutes after saving except Quick Nudge; it is not a rollback of push notifications already delivered.

## Actions

| Action | Who | Preview card | Tap that saves / shared path | Recheck | Undo | Example phrasing |
|---|---|---|---|---|---|---|
| `create_task` | Managers and up | Title, people/roles and duration | **Create task** → `createStandardQuickTask` in `src/lib/quickTasks.ts` | Preview checks recipients; tap requires the current user/store and uses database permissions. No separate server recheck call | 10 minutes: `deleteQuickTask` removes the created task | “Create a task for John to clean the fridge.” |
| `create_event` | Managers and up | Title, category, dates/times, notes, roles, recurring/daily-task/meeting flags | **Add event** → `createScheduleEvent` in `src/lib/scheduleEvents.ts` | Server rechecks proposal, store/role, category and duplicates; only admin and above can create a new category | 10 minutes; refused if a daily-task completion or attendee was added. Newly created category removed only if unused | “Add a manager meeting next Tuesday at 3 PM.” |
| `cover_shift` | Managers and up | Original shift, replacement and day view | **Confirm change** → `reassignAndNotify` in `src/lib/scheduleActions.ts` | Server checks current shift, access and eligible coverage; time off, availability and overlaps matter, role tag is a flag | 10 minutes: reassign back after server permission check | “Can Sarah cover John's Friday shift?” |
| `add_shift` | Managers and up | Person, date, hours and day view | **Add shift** → `addShift` in `src/lib/scheduleActions.ts` | Server checks access, person, date/hours and conflicts | 10 minutes: delete the added shift after server permission check | “Add Dave tomorrow from 4 PM to 9 PM.” |
| `delete_shift` | Managers and up | Person, shift and day view | **Delete shift** → `deleteShift` in `src/lib/scheduleActions.ts` | Server rechecks shift and protected-state conditions; keeps the full removed row for Undo | 10 minutes: restore the removed row after server permission check | “Remove Jane's Saturday shift.” |
| `swap_shift` | Managers and up | Both people/shifts and both day views | **Swap shifts** → `swapShiftsAndNotify` in `src/lib/scheduleActions.ts` | Server rechecks both shifts, people and conflicts | 10 minutes: swap back through the shared path after server permission check | “Swap John's Friday shift with Sarah's Saturday shift.” |
| `change_shift` | Managers and up | Original/new hours and day view | **Change hours** → `updateShiftTimes` in `src/lib/scheduleActions.ts` | Server rechecks current shift, hours and conflicts | 10 minutes: restore old hours after server permission check | “Change John's start time tomorrow to 5 PM.” |
| `send_message` | Managers and up | Recipient/chat, message and optional reply quote | **Send** → `sendChatMessage` in `src/lib/chatMessages.ts`; new DM uses `findOrCreateDm` | Server rechecks caller's membership/store scope, recipient/chat and reply target; sensitive pay/discipline requests are blocked | 10 minutes: `unsendMessage`; delivered push is not recalled | “Reply to Sarah: Thanks, I'll check it.” / “Message John to bring his shirt tomorrow.” |
| `clock_punch` | Managers and up | ONE named person, in/out, time and shift warnings; actual clock-in shown for clock-out | **Confirm** → `savePunchReturning` in `src/lib/punches.ts` | `_shared/punchPlan.ts` supplies preview/tap/Undo rules; server rechecks current punch status, schedule and meetings | 10 minutes: remove only Theo's punch after server verification; placeholder shift removed only when safe | “Clock John in now.” / “Clock Cheyenne out at 8:30 PM.” |
| `quick_nudge` | Managers and up **plus `brand_admin`** | Checklist/task/event, message and who gets it | **Send nudge** → `sendQuickNudge` in `src/lib/quickNudges.ts` → `quick-nudge` | Server recomputes eligible on-clock audience, target status and cooldown; optional `recipient_ids` intersect that audience | None; the push cannot be unsent | “Nudge everyone on the clock to finish the opening checklist.” / “Nudge Mauricio and Shayli about the delivery task.” |
| `post_announcement` | Managers and up | Channel (default everyone), subject/body and recipient count | **Post announcement** → `createFeedPost` in `src/lib/feedPosts.ts` | Server rechecks the logged preview and channel audience/access; pay/discipline guard | 10 minutes: `deleteFeedPost` removes the post; delivered push remains | “Post an announcement to everyone: Team meeting Friday at 3 PM.” |

### Important action limits

- Schedule edits and Undo use the shared schedule paths; published weeks also run Update/notification handling. An added new week starts as a draft. Undo does not promise silence or recall earlier notifications.
- A clock-in without a scheduled shift warns that confirmation adds a placeholder shift. Clock-out never supplies a `shift_id`; this is manager quick punching, not crew self clock-in.
- Quick Nudge's one rule path is `_shared/nudgePlan.ts` plus `checklist_nudge_status`, `task_nudge_status`, `event_nudge_status`; on-clock eligibility comes from `_shared/onClock.ts` (open paired Toast shifts at Toast stores). Sender and people nudged about that item within the last hour are excluded. Sends are logged in `nudge_log`.
- Named nudges never auto-include fuzzy spelling guesses. Unknown, off-clock or cooldown recipients do not receive the nudge. If no named person qualifies, Theo asks for clarification or permission to nudge everyone instead; it never silently broadens the audience. Omitting names preserves the everyone-eligible-on-clock default.
- Announcements are text only: subject at most 120 characters, body at most 2,000. No media, pin, badge or scheduled posting.

## Planned: shift marketplace actions (not live yet)

These ship with the shift marketplace redesign. They use the same preview wizard and `DayRows` day view (`src/components/schedule/DayRows.tsx`). The app side is built (feed card `src/components/feed/OpenShiftCard.tsx`, RPCs in `supabase/migrations/20261023033000_shift_marketplace_rpcs.sql`); Theo tools are not. Until that ship, Theo can only read offers through `query_shift_marketplace`.

| Action | Who | Preview card | Tap that saves | Recheck | Undo | Example phrasing |
|---|---|---|---|---|---|---|
| `marketplace_status` (read) | Managers and up (crew: own offers only) | Offer, owner, status and every claimer with claim time | None, read only | Store access | n/a | "Did anybody claim John's Friday shift?" |
| `claim_shift` | Managers and up | Shift, the person claiming it and day view (owner Removed, claimer Covering, or New if already on that day) | **Claim shift**, instant for managers and up, one atomic approve | Server (`assign_shift_offer`) rechecks the offer is open, the shift hasn't started and still belongs to the owner, and store access. Availability, time off, overlaps and sixth day are shown in the picker but not enforced. | 10 minutes: return shift to owner, reopen offer | "Claim Sarah's Saturday shift for me." |
| `assign_shift` | Managers and up | Shift, chosen person (availability and sixth-day tags) and day view | **Assign shift**, one atomic approve | Same as claim; the person must be at this store | 10 minutes: same as claim | "Give John's Friday shift to Dave." |
| `approve_claim` | Managers and up, including general managers | Offer, chosen claimer, other claimers and day view | **Approve**, one atomic step; pushes winner, owner and losing claimers | Server (`approve_shift_offer`) rechecks the claim is still pending, the shift hasn't started and is unchanged | 10 minutes: same as claim | "Approve Dave's claim on John's shift." |
| `deny_claim` | Managers and up, including general managers | Offer and the claimer being denied | **Deny**: removes that claim, offer stays open | Server (`deny_shift_offer_claim`) rechecks the offer is still open | None (the person can claim again) | "Deny Mia's claim on the Sunday shift." |

## Read tools

Read tools do not save actions. Access and privacy checks still apply. Today's simple sales, goal, labor, on-clock, schedule and open-work questions may be answered directly from the store snapshot; other dates and missing details use tools. Labor totals always come from `get_store_labor` as the asking user's client, outside the shared snapshot cache.

| Tool | What it reads |
|---|---|
| `query_sales` | Sales, guests, hourly totals, goals/projections and product mix for the requested window. |
| `query_labor` | Store labor totals through the signed-in user's `get_store_labor` path, with permission-controlled detail. |
| `query_schedule` | Published shifts, people, positions and times for requested dates. |
| `query_checklists` | Existing checklist/submission lookup; unchanged by the History tools. Use the History tools for completion scoring and item fallback. |
| `query_tasks` | Existing quick-task and alarm lookup; unchanged by the History tools. |
| `query_task_history` | The same signed-in-user loaders as Tasks > History: checklist percentages/header average, completed quick tasks, done/missed alarm slots, completed daily-task events and logbook entries, up to 14 days; today's open tasks added only after store-access verification. |
| `query_checklist_items` | One checklist/day's expected items via `planChecklistDay`, History-window responses, done/not done, answer, temperature/in-range result, photo presence, who/when and missing items. |
| `query_logbook` | Logbook entries and categories, including drawer and safe counts. |
| `query_labor_intelligence` | Nightly labor grades, findings and staffing recommendations for past days; not a live today report. |
| `query_catering` | Catering orders, pickups, customer names, items and status. |
| `query_availability` | Availability/time-off requests, dates, status and pending counts. |
| `query_tips` | Daily cash and card tip totals for a date range. |
| `query_certifications` | Employee certifications, expiry dates and approval status. |
| `query_shift_marketplace` | Shift offers, claims, pickups and statuses, filtered by shift date. |
| `query_store_hours` | Store opening and closing hours by weekday. |
| `query_employee_notes` | Permission-restricted employee notes/write-up records; not permission to edit them. |
| `query_ovation_reviews` | Guest feedback plus a ready-made rating/count summary for the asked store-local window. |
| `query_my_chats` | Keyword/person searches in the asking manager's own chats, with membership and store filtering. |
| `query_callout_patterns` | Published schedule versus attendance/time off: missed shifts, replacements and impact. |
| `query_punch_patterns` | Scheduled-versus-actual attendance patterns and ready lateness flags (7-minute grace); not punch editing. |
| `query_crew_performance` | Crew compositions correlated with sales, labor and checklist outcomes across dates. |
| `query_inventory` | Parked implementation only: filtered out of `THEO_TOOLS`, not offered to Theo. Inventory remains unavailable. |
| `find_crew` | Resolves one/multiple names to actual store crew; old matching first, fallback guesses clearly shown, ranked on-clock then scheduled today then others. |
| `find_shifts` | Resolves current shifts needed for cover/add/delete/swap/hour-change previews. |
| `cover_candidates` | Lists eligible cover candidates using the shared availability/time-off/overlap rules; role mismatch is flagged. |

Other read helpers: `find_chats` and `read_chat` use the same caller-membership/store scope (no hiring/support chats). `fetch_resource_content` remains a typed-chat training-resource helper; it is omitted from voice and does not make the archived LMS usable.

The History tools use `_shared/fuzzyMatch.ts` for title/item/name matching and did-you-mean suggestions. Their shared core lives at `src/lib/taskHistory/core.ts` with a byte-identical server copy at `supabase/functions/_shared/taskHistory/core.ts`, enforced by `core.parity.test.ts`.

**History status rule:** History lists completed work and missed alarm slots. Missing from History never means “not done”; that claim comes only from `open_quick_tasks`. Open status is known only for today. Item-level missing answers come from `query_checklist_items`' expected-item set. Known preserved monthly-window, missed-alarm-offset and historical-close-time quirks are documented in `THEO_DATA.md`.

## Not yet

- Punch/break edits: no changing, repairing or deleting existing punches/breaks through Theo; quick in/out and its limited Undo are the existing exception.
- Per-person hours/overtime: no dedicated verified individual payroll-hours/overtime answer path. Existing labor/attendance tools are not a promise of payroll-grade per-person totals.
- Events calendar: event creation and completed daily-task History are available, but no general events-calendar browsing tool.
- Inventory: no counting, stock, ordering, food cost or inventory actions. Item sales are sales data and remain available. See `THEO_INVENTORY.md`.

## Change log

- 2026-10-14: Created the hands companion with current actions, read tools and Task History/item lookups. Documentation only; no behavior changes.
- 2026-10-22: Added planned shift marketplace actions (status, claim, assign, approve, deny). Not live until the marketplace redesign ships.