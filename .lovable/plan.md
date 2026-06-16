# Visual Alerts (deep-linked dialog system)

A reusable "playing-card stack" dialog that greets users with actionable push notifications they haven't seen yet. v1 covers **quick tasks** and **overdue checklists**.

## How it behaves

- A push notification is sent → a row is written to `visual_alert_queue` for that user.
- User taps the push → app opens, the matching alert is pulled from the queue and shown immediately as the top card.
- User opens the app organically (no tap) → on Dashboard mount, any unseen queued alerts for that user render as a fanned stack of cards.
- Each card has a big **Complete Task / Complete Checklist** primary button and a small faded **Exit** ghost button.
- **Complete** → for quick tasks with subtasks: opens the subtask dialog inline. For tasks without subtasks: marks complete. For checklists: navigates to `/complete/<id>`.
- **Exit** → dismisses just that card (marks it `seen`), reveals the next card behind it. Item stays in Tasks/Dashboard until actually completed.
- Each notification = one impression. Once `seen_at` is set, that card never reappears (even on reinstall).

## Visual treatment

- Card stack pinned to viewport center, fanned ~3–5° per layer, top card fully readable, tabs of cards behind it visible (max 3 tabs, "+N more" badge if larger).
- Swipe up / tap Exit → top card animates out, next card snaps forward.
- Domain icon + title + 1-line description per card.
- Reusable shell: `<VisualAlertStack />` mounted once at the app root.

## Backend

**New table: `visual_alert_queue`**
- `id`, `user_id`, `alert_type` ('quick_task' | 'overdue_checklist'), `ref_id` (task/checklist id), `notification_id` (unique key per push event), `title`, `body`, `location_id`, `created_at`, `seen_at` (nullable), `expires_at`
- Unique on `(user_id, notification_id)` so re-fires don't double-queue.
- RLS: user can SELECT/UPDATE own rows; service_role full access.
- Auto-expire after 7 days (cron prune).

**Write path:**
- In `send-push-notification` (and `alert-push-sender` for alarm tasks), when the notification type is `quick_task` / `overdue_checklist`, also insert into `visual_alert_queue` for each recipient. Same `notification_id` goes into the push payload's `data` so the deep link can highlight that exact card.

## Frontend

**New hook: `useVisualAlerts()`**
- Subscribes to `visual_alert_queue` where `user_id = me AND seen_at IS NULL`.
- Returns ordered array of unseen alerts.
- Exposes `markSeen(id)` (UPDATE seen_at = now()).

**New component: `src/components/visual-alerts/VisualAlertStack.tsx`**
- Mounted in `App.tsx` once, above route content.
- Renders nothing if no unseen alerts.
- Renders fanned card stack otherwise.
- Auto-opens to the alert matching `?alert=<notification_id>` URL param (set by the service worker deep link).

**Service worker update (`public/sw-push.js`)**
- For `data.type === 'quick_task'` → deep-link to `/?alert=<notification_id>` (lands on Dashboard with the card already on top).
- For `data.type === 'overdue_checklist'` → same: `/?alert=<notification_id>`.

## Files touched

- `supabase/migrations/<new>.sql` — `visual_alert_queue` table + RLS + grants + prune function.
- `supabase/functions/send-push-notification/index.ts` — queue insert hook for the two alert types.
- `supabase/functions/alert-push-sender/index.ts` — queue insert for overdue checklist alerts.
- `public/sw-push.js` — `?alert=` deep link routing for the two types.
- `src/components/visual-alerts/VisualAlertStack.tsx` — new.
- `src/components/visual-alerts/VisualAlertCard.tsx` — new.
- `src/hooks/useVisualAlerts.tsx` — new.
- `src/App.tsx` — mount `<VisualAlertStack />`.

## Not in v1 (easy to add later)

- Announcements, read-and-sign, shift swaps, alarm tasks as visual alerts.
- "Snooze 15 min" option on Exit.
- Sound/haptic on stack appearance.
