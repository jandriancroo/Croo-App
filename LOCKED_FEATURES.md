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


### Live Labor — One Punch Path Everywhere
**Files:**
- src/utils/liveLabor.ts (canonical client helper: fetchLiveLaborForToday)
- supabase/functions/_shared/punchLabor.ts (canonical server helper: calculatePunchLabor)
- src/components/punchclock/ManagerDashboardOverlay.tsx
- src/components/dashboard/SalesSummary.tsx
- supabase/functions/watch-device-service/index.ts

**Description:** Every surface that shows live/today labor MUST get it from the
shared punch helper. Rules:
- QuBeyond is SALES TRANSPORT ONLY. It has zero involvement in labor on any
  surface at any location. Never gate labor display on QU authentication or on
  any POS integration existing.
- No local reimplementation of live labor math, and no direct labor_cache query
  for today (labor_cache is closed-day history only).
- Any new labor-displaying surface must call the shared helper.
- Out of scope (different product meaning, do not change): scheduled/projected
  labor on Schedule (LaborTotals / DayBreakdown / MobileDayPreview),
  LaborIntelligenceCard, BrandDashboard, historical labor_cache writers.

**Last Updated:** 2026-09-18
