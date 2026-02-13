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

