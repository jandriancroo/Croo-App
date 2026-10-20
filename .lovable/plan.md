# Phase 6 — Smaller phone titles + status lines: STEP 0 report

Nothing has been built or changed. This is the report. Waiting for "go".

## 1. Status line per page

| Page | Title at | Count source | Who sees it | Verdict |
|---|---|---|---|---|
| Dash | `pages/Dashboard.tsx:620` | `get_labor_pace`: `sales_pace`, `pace_labor_pct`, `status`. The goal comes from the Sales Summary's goal already in the app's memory (same pick as the Dash scoreboard), not a new query. | Labor part: whoever `get_labor_pace` lets in (managers+, team members with view_sales, punch devices). Otherwise the date. | **Cheap** (one call, polls 60s while visible) |
| Messages | `pages/Messages.tsx:67` | `useChatUnreadCounts` already loaded at `:20` (`chats`, `announcements`) | Same user's own counts | **Ready** |
| Tasks | `pages/Tasks.tsx:65` | `completionPercent` already worked out at `:44` (same number as the circle) | Everyone on the page | **Ready**. The circle in the action slot shows the same %, so the line would repeat it. Proposal: keep both, or drop the circle (decision 3). |
| Logs | `pages/LogBook.tsx:106` (the second title at `:95` "Library" uses the default date) | One count: `logbook_entries` where location = store and `entry_date` = store today, `head: true` (uses `idx_logbook_entries_location_date`) | Same RLS as the page list | **Cheap** |
| Schedule (phone) | `components/schedule/MobileScheduleView.tsx:1046` (manager) and `:821` (staff) | No "on the clock" number exists on the server today; the dock's version is worked out in the locked dock (`dock/CompactDashboard.tsx:324`). A count would need new logic over `time_punches` (latest punch per person). | Managers+ | **Drop for now**, use the date. Alternatively, a later approved server count. |
| Schedule (desktop) | No shared title; desktop uses its own sticky toolbar (`pages/Schedule.tsx:340`) | — | — | **Drop**: no title row to put it on without redesigning that toolbar |
| Availability | `pages/Availability.tsx:66` | `requests` already loaded in `useAvailabilityData.tsx:141` (has `created_at`); count the ones created today in the store timezone | Managers who can approve see all; staff see their own (same as the list) | **Ready** |
| Hiring | `pages/Hiring.tsx:500` | One count: `job_applications` where location = store and `created_at` within today's store window, `head: true` (uses `idx_job_applications_location`; no date index, but per-store rows are few) | Same RLS as the applicant list | **Cheap**. Today the title has a subtitle (brand / org name) that would sit under the title. |
| Users | `pages/UserManagement.tsx:29` | `users` already loaded in `useUserManagementData.tsx:133` (`is_active`) | Same as the page | **Ready** |
| Settings | `pages/Settings.tsx:519` | — | — | See section 2 |

Zero wording: `ALL CAUGHT UP`, `NO NEW LOGS TODAY`, `NO NEW REQUESTS TODAY`, `NO NEW APPLICANTS TODAY`, `NO TASKS DONE YET`. While a count is loading, the line shows the date, so the height never jumps.

## 2. Settings — "Manager Preferences"

There is no control called "Manager Preferences" in the app. What sits around the Settings title today:
- `Settings.tsx:519`: subtitle text "Manage your preferences" (plain words, no tap).
- `Settings.tsx:521-529`: the location / organization / Super Admin pill switch. Only org admins and up see it.

Proposal: the status line spot shows nothing on Settings, the "Manage your preferences" words go away, and the pill switch stays where it is. **Please confirm which control you meant** (decision 1).

## 3. Fit at 390

- **Dash:** the content row is about 358px wide. At 12px semibold uppercase with 0.06em spacing, `PACE $12,560 / $12,400 · LABOR 31.5%` (the longest likely line) is about 300px. It fits on one line, and it truncates if not.
- **Schedule:** "Schedule" at 22px is about 95px. The split button at h-10 is about 150px. Together about 260px of 358px, so it fits with room.

## 4. iPad / desktop (md+)

The 29px title, accent bar, 44px row and actions stay the same. The only change is the status line above, which adds about 18px to every page at the same height. Pages that may look off:
- Hiring: a status line above and the brand / org subtitle below. That's busy but readable.
- Tasks: the % repeated in the line and the circle.
- Desktop Schedule: no title, so nothing changes there.

## 5. Also in this batch

- **Brand Dash** tab row at `pages/BrandDashboard.tsx:369`: switch to a scrolling row (`w-full justify-start overflow-x-auto no-scrollbar`, triggers `shrink-0`). Styling only.
- **Time Tracking** `components/timetracking/PayPeriodSelector.tsx:226-232`: replace the old 22px heading and its line underneath with PageTitle. Status = the current pay period, e.g. `PERIOD OCT 13 – 26`, from the `current` period this screen already has. When there is no current period, it shows the date. This is the manager pay-period list, not the punch clock.

## 6. Locked / protected

Nothing touches DockContent, `components/dock/*` (the on-clock logic there is only read for this report, not reused), the cubes, EditDashboardDialog, inventory (beyond the already-unlocked Inventory.tsx title), toasts, support, punch clock / time clock screens, Nudge files, or any labor function. The Dash only *reads* `get_labor_pace`. There is no labor math in the app.

## Decisions needed before "go"

1. Settings: which control is "Manager Preferences"? (Or approve: no line, subtitle removed, pill switch stays.)
2. Schedule "on the clock": OK to show the date for now (dropped), or approve a small new server count later?
3. Tasks: keep the % circle and the line, or remove the circle?

## Technical details

- PageTitle gets `status?: { text: string; tone?: 'muted' | 'warning' }`. The default is today's date from `location_settings.timezone` via Luxon (`EEEE, MMM d`, uppercase). `warning` uses the existing amber token, never a hard-coded color.
- Phone: `text-[22px]`, no bar, `min-h-10` row, action slot sized for 40px. md+: `md:text-[29px]`, bar shown, `md:min-h-11`. The status line is `text-xs font-semibold uppercase tracking-[0.06em] truncate text-muted-foreground`.
- Counts use `select('id', { count: 'exact', head: true })` with the user's own session, so the same row rules apply.
