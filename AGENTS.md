
- Role settings (role_permissions, role_notification_settings) are per organization; new orgs are seeded from *_template tables by trigger. Why: one org admin must not change every org.
- Labor shift pairing lives only in _labor_pair_shifts; labor_day_user_totals, labor_shifts and pay-period close guard all read it. Why: one source of truth.
- Auto clock-out is decided only by public.run_auto_clock_out() (pg_cron, SQL, no HTTP) and the auto_clock_out_settings.mode switch, changed by migration only. Why: one writer, no request-supplied stores or dates.
- Toast sales arrive only through toast-sync day payloads (export > live; api = export rank); fetchers are swappable, never write sales_cache directly. Why: homemade today, official API later without touching readers.
- Toast employee mappings immediately synchronize matching toast_shifts rows by location and Toast user ID. Why: linked badges and read-only schedule pairing must update without waiting for the next robot pull.
- Interview calendar files expose only signed CrooHQ join URLs; the raw video-call URL stays server-side. Why: Google Calendar rewrites raw Meet links during import.
- Toast robot health is judged only by toast-watchdog (pg_cron 5 min, reads CrooHQ data, never calls Toast); it restarts the GitHub robot and alerts super admins, and the runner caps full Toast sign-ins at 4/day via toast-service heartbeat. Why: a browser robot will break, so breaks must be caught in minutes without hammering Toast.
- Store counting pack comes only from public.get_store_pack_lens / v_store_pack_lens (single config → all stores; several → SKU match; else pinned today's pick, flagged); inventory_items.pack_quantity_override is retired and never read. Why: deterministic, per-store pack that matches what the store buys.
