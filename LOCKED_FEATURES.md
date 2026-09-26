# 🔒 Locked Features

> **IMPORTANT**: These features are stable and should NOT be modified unless explicitly requested by the user. Check this file before making changes.

---

## How to Use This File
- Add features here once they're working correctly
- Include the file path(s) and a brief description
- AI should check this file before modifying any listed components

---

## Locked Features

### 1. Birthday Sync System
**Files:**
- `supabase/functions/sync-birthday-events/index.ts`
- Related: `src/pages/Schedule.tsx` (birthday event display)

**Description:** Syncs user birthdays to the holidays table, one entry per user per location. Handles duplicates and updates.

**Last Updated:** January 2026

---

### 2. Date Parsing (Timezone-Safe)
**Files:**
- `src/utils/dateUtils.ts` - `parseDateOnlyToLocalDate()` function
- Used in: `src/pages/MyProfile.tsx`, `src/pages/UserManagement.tsx`

**Description:** Parses YYYY-MM-DD date strings without timezone shift issues.

**Last Updated:** January 2026

---

### 3. Support Ticket System
**Files:**
- `src/components/support/*`
- `src/pages/Alerts.tsx` (admin view)
- Database: `support_tickets` table

**Description:** User support request system with categories, screenshots, resolution workflow.

**Last Updated:** January 2026

---

### 4. Weekly Summary Email
**Files:**
- `supabase/functions/support-email-service/index.ts` (generation & formatting)
- `src/pages/EmailPreview.tsx` (preview UI with week-range picker)
- `src/components/logbook/WeeklySummaryEntry.tsx` (display component)

**Description:** Aggregated Mon-Sun weekly email with sales breakdown, labor vs target, checklist completion, and cash handling. Uses unified Daily Summary design template with 720px container, 24px border-radius, Manrope font, linear gradient header, and beige footer.

**Last Updated:** February 2026

---

### 5. Email System (All Templates)
**Files:**
- `src/pages/EmailPreview.tsx` (Email Design Studio preview interface)
- `supabase/functions/support-email-service/index.ts` (Daily & Weekly Summary generation)
- `supabase/functions/hiring-email-service/index.ts` (Hiring emails: Invite, Rejection, Interview)
- `supabase/functions/notify-hiring-message/index.ts` (Applicant chat notifications)
- `supabase/functions/send-weekly-schedule-email/index.ts` (Employee & Manager schedule emails)
- `supabase/functions/send-notification-email/index.ts` (Employee write-ups & performance reviews)

**Email Templates Locked:**
- Daily Summary (logbook end-of-day recap)
- Weekly Summary (aggregated Mon-Sun sales, labor, checklists, cash handling)
- Support Ticket notifications
- Weekly Schedule (Employee individual shifts)
- Weekly Schedule (Manager team grid)
- Hiring - Invite/Onboarding
- Hiring - Rejection
- Hiring - Interview Invite
- Hiring - Chat Message (applicant notifications)

**Description:** All system email templates are finalized with unified design system (720px container, 24px border-radius, Manrope font, 3-column header layout, linear gradient buttons, beige footer). All use America/Los_Angeles timezone for timestamp display. Do NOT modify styling, layout, or content without explicit unlock request.

**Last Updated:** February 2026

---

## Template for Adding Features

```markdown
### [Feature Name]
**Files:**
- file1.tsx
- file2.ts

**Description:** Brief description of what this feature does.

**Last Updated:** [Date]
```

---

*Add new locked features below this line:*


### One Store Labor Number
**Source of truth (database):** labor_day_user_totals / labor_day_totals (the only
labor math), get_store_labor (the one store labor lookup), business_date /
business_day_window, labor_new_rule_start() = 2026-09-26.

**Rules:**
- Hours, labor $, labor %, and cut savings are computed server-side only. Screens
  display; no client-side labor math.
- Source per store: "Pull Qu Labor %" on → qubeyond rows; off → punch_clock.
- Breaks: length rule, per-store labor_rules.unpaid_break_min_minutes (default 30,
  inclusive). Straight wages, no OT.
- Dates before labor_new_rule_start() keep the legacy math and are never rewritten.
- Virginia St (5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d) stays on the legacy path.
- labor-service writes closed punch_clock days from labor_day_totals only;
  backfill_labor uses a 7-day lookback clamped to the cutoff.
- Existing RPC access gates (manager / paired device) must not change.

**Last Updated:** 2026-09-26

---

## LOCKED: Availability can't-work blocks

**Files:**
- src/types/availability.ts (canonical types + helpers)
- src/hooks/useLocationWeeklyHours.ts
- src/components/availability/EmployeePreferencesDialog.tsx
- src/components/availability/SchedulingPreferencesSection.tsx
- src/components/schedule/EmployeeRow.tsx
- src/components/schedule/EditShiftDialog.tsx
- supabase/functions/schedule-service/index.ts (isEmployeeAvailable)

**Description:** Weekly availability on `profiles.weekly_availability` stores
CAN'T-WORK blocks, not a can-work window. Rules:
- Day toggle OFF = `{ available: false }` (off all day).
- Day toggle ON = can work, with 0..N `blocks: [{ start, end }]` of UNAVAILABLE
  time. ON with no blocks = available all day.
- Schedule chips, popovers and conflict copy always read "Unavailable …" (one
  line per block). Never "Can only work …".
- Legacy `{ available, start?, end? }` ("can only work") is migrated on read via
  `normalizeWeeklyAvailability`, using that location's `location_hours` for the
  edges, falling back to 11:00–22:00 only when the location has no hours.
  Overnight/ambiguous store hours produce no blocks (never block allowed hours).
- Never wipe existing preferences. Never read raw `start`/`end` directly.
- Any surface reading weekly availability must use the shared helpers in
  src/types/availability.ts — no local reimplementation.
- Out of scope: availability_requests / time-off flow, min/max weekly hours.

**Last Updated:** 2026-09-18
