
- Subdirectories have their own AGENTS.md (supabase/functions/AGENTS.md holds all Theo and Quick Nudge rules); read it before changing files there.
- Role settings (role_permissions, role_notification_settings) are per organization; new orgs are seeded from *_template tables by trigger. Why: one org admin must not change every org.
- Labor shift pairing lives only in _labor_pair_shifts; labor_day_user_totals, labor_shifts and pay-period close guard all read it. Why: one source of truth.
- Auto clock-out is decided only by public.run_auto_clock_out() (pg_cron, SQL, no HTTP) and the auto_clock_out_settings.mode switch, changed by migration only. Why: one writer, no request-supplied stores or dates.
- Toast sales arrive only through toast-sync day payloads (export > live; api = export rank); fetchers are swappable, never write sales_cache directly. Why: homemade today, official API later without touching readers.
- Toast employee mappings immediately sync matching toast_shifts rows by location + Toast user ID. Why: badges and schedule pairing update without waiting for the robot.
- Interview calendar files expose only signed CrooHQ join URLs; the raw video-call URL stays server-side. Why: Google Calendar rewrites raw Meet links during import.
- Store counting pack comes only from get_store_pack_lens / v_store_pack_lens; inventory_items.pack_quantity_override is retired, never read. Why: per-store pack matches what the store buys.
- Shift-swap phone alerts (offered / claim / approved) are queued only by the shift_offers + shift_offer_claims triggers into alert_queue; clients never send them. Why: alerts fire no matter which screen made the change.

- POS list: server only _shared/posSources.ts, client only src/lib/pos/liveSales.ts; never a hard-coded fallback POS (unknown = null). Why: missing lists mislabeled Hayward.
- New data/POS source: update data_point_registry in the same migration. Why: one writer map.
<!-- LOVABLE:BEGIN -->
- Settings mode uses useStationMode + ScheduleOrganizeBy for one query/save; sales goal display stays separate from labor denominators. Why: prevent drift.
<!-- LOVABLE:END -->
- Manager duplicate punches (2nd clock-out, overlapping break) are blocked only by trigger trg_zz_guard_manager_duplicate_punch (skips kiosk/self/auto); edit screens use src/lib/punchEditGuard.ts. Why: no double-punched shifts.
- Dashboard daily-task events use todaysScheduleEvents for local-day selection and the same mergeScheduleEvents deduplication as the schedule hook. Why: prevent cross-date events and duplicate template rows without changing schedule screens.
- SpookifiedEffects is theme/Dashboard-scoped; lightning stays in TheoVoiceOrb. Why: isolate decorations from data and other themes.
- Apple Watch app (watch/, ios/) is edited and built only on the Mac Studio in Xcode; Lovable never edits watch/ or ios/. Watch data comes only from the watch-device-service snapshot (cubes = the pairing user's own dashboard for that store); the phone only hands over pairing. Why: one source of truth and no merge clashes.
- Watch chats: the watch-device-service chats/thread/send actions are the only chat send path besides src/lib/chatMessages.ts; scoped to the pairing user's own chats at the store, plain text, ordinary DMs and groups only, same message row and push. Why: a watch has no signed-in browser session, so the server sends as the paired user.
- Widgets and complications (widgets/, built from the same Xcode project) are read-only: they call only the watch-device-service snapshot with the paired device token, shared through the App Group group.com.croohq.kitchenmate. The labor green/red line uses labor_goal_pct from that snapshot; with no goal set it stays neutral and never guesses a number. Why: one source of truth, and widgets run without the app open.
- Single-choice view switches use ui/segmented-control.tsx and weekday multi-pickers use ui/day-toggle-row.tsx (callers keep their own toggle function). Why: one shape app-wide without touching saved values.
- Labor projection comes only from get_labor_projection (worked = the same labor_day_totals / labor_cache row get_store_labor reads; today's sales pace = sales_pace_today, kept equal to cubeMetrics.computePace by scripts/check-labor-projection-sql.ts). Why: projection, Dash and labor totals never disagree.
