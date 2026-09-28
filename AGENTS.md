
- Role settings (role_permissions, role_notification_settings) are per organization; new orgs are seeded from *_template tables by trigger. Why: one org admin must not change every org.
- Labor shift pairing lives only in _labor_pair_shifts; labor_day_user_totals, labor_shifts and pay-period close guard all read it. Why: one source of truth.
- Auto clock-out is decided only by public.run_auto_clock_out() (pg_cron, SQL, no HTTP) and the auto_clock_out_settings.mode switch, changed by migration only. Why: one writer, no request-supplied stores or dates.
- Toast sales arrive only through toast-sync day payloads (export > live; api = export rank); fetchers are swappable, never write sales_cache directly. Why: homemade today, official API later without touching readers.
