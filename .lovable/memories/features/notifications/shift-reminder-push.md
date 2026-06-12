---
name: Shift Reminder Push
description: 30-min-before-shift push notification dispatched every minute via shift-reminder-dispatch; toggle via notification_preferences.shift_reminders (default true)
type: feature
---

Every minute, `shift-reminder-dispatch` edge function (scheduled via `pg_cron` job `shift-reminder-dispatch-every-minute`) scans `scheduled_shifts` for shifts whose local start time (resolved via `location_settings.timezone`, default `America/Los_Angeles`) falls 28–32 minutes from now.

Filters applied in order:
1. `user_id IS NOT NULL` and `is_time_off = false`
2. Not present in `shift_reminder_log` (PK on shift_id → idempotent, survives cron drift)
3. `notification_preferences.shift_reminders` is not explicitly `false` (default true if no preferences row exists)

Sends via existing `send-push-notification` with `notification_type='shift_reminders'`, then logs the shift_id to `shift_reminder_log`.

UI toggle: Settings → Notifications → "Shift Reminders (30 min before)" — defaults ON.

If lead time ever changes, edit `REMINDER_MINUTES` in `supabase/functions/shift-reminder-dispatch/index.ts`. Window tolerance is ±2 min.
