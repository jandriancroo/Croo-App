---
name: Day Part Pulse & Shift Overstay Alerts
description: Day Part Pulse (AM at per-location cutoff, PM at close) and Shift Overstay (>5 min past scheduled end) push notifications, dispatched via plpgsql + alert_queue
type: feature
---

## Day Part Pulse
- `send_day_part_pulse()` plpgsql cron'd `*/15 * * * *` (job `day-part-pulse-every-15min`).
- AM fires in the 15-min window starting at `location_settings.day_part_am_cutoff` (default `16:00:00`, editable per location in Settings → Notifications by managers+).
- PM fires in the 15-min window starting at `location_hours.close_time` for the local day.
- Dedup key: `day_part_pulse_<loc>_<yyyy-mm-dd>_<am|pm>`.
- AM body uses partial sales from `sales_cache.hourly_data` (hours < cutoff). PM body uses `sales_cache.net_sales`.
- Recipients = users at location with manager-tier role, opted in via `role_notification_settings.day_part_pulse`, not opted out via `user_notification_settings.day_part_pulse.push_enabled = false`.

## Shift Overstay
- `send_shift_overstay_alerts()` plpgsql cron'd `* * * * *` (job `shift-overstay-every-minute`).
- Finds the latest punch per (user, location) in last 24h, where `punch_type = 'clock_in'` (no clock_out yet) and the joined `scheduled_shifts.end_time` is 5–120 min past in the location's timezone.
- Dedup key: `overstay_<punch_id>` — one alert per shift, ever.
- Recipients = the employee + managers/admins at the location, respecting per-user opt-out (`shift_overstay.push_enabled = false`).

Both queue into `alert_queue` and are dispatched by the existing `alert-push-sender` edge function (generic path, no special handler needed).

UI: Settings → Notifications → "Sales Pulse" section (managers only) holds Hourly Pulse, Day Part Pulse, and the AM cutoff time input. "Shift Overstay" toggle lives in the general section (visible to all users — employees can opt out of self-reminders).
