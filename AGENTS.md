
- Role settings (role_permissions, role_notification_settings) are per organization; new orgs are seeded from *_template tables by trigger. Why: one org admin must not change every org.
- Labor shift pairing lives only in _labor_pair_shifts; labor_day_user_totals, labor_shifts and pay-period close guard all read it. Why: one source of truth.
- Auto clock-out is decided only by public.run_auto_clock_out() (pg_cron, SQL, no HTTP) and the auto_clock_out_settings.mode switch, changed by migration only. Why: one writer, no request-supplied stores or dates.
- Toast sales arrive only through toast-sync day payloads (export > live; api = export rank); fetchers are swappable, never write sales_cache directly. Why: homemade today, official API later without touching readers.
- Toast employee mappings immediately sync matching toast_shifts rows by location + Toast user ID. Why: badges and schedule pairing update without waiting for the robot.
- Interview calendar files expose only signed CrooHQ join URLs; the raw video-call URL stays server-side. Why: Google Calendar rewrites raw Meet links during import.
- Store counting pack comes only from get_store_pack_lens / v_store_pack_lens; inventory_items.pack_quantity_override is retired, never read. Why: per-store pack matches what the store buys.
- Theo voice: the browser connects to Grok live voice only with a 5-minute pass minted by the theo-voice function, and every store-data question goes through ai-assistant via the ask_theo tool. Why: the xAI key stays server-side and voice Theo uses the same brain and permissions as text Theo.
- Shift-swap phone alerts (offered / claim / approved) are queued only by the shift_offers + shift_offer_claims triggers into alert_queue; clients never send them. Why: alerts fire no matter which screen made the change.
- Theo (ai-assistant) gets labor totals only from get_store_labor called with the asking user's client, store time zone from location_settings, "today" from business_date and day filters from business_day_window; labor never goes in the shared cached snapshot. Why: Theo must show the same number as the dashboard and never leak labor across permissions.
- Theo voice: opener via xAI TTS, live voice only for conversation, one mic graph tap-to-end (audio held, pass prefetched), cues only when Theo isn't speaking, turns end on server-VAD silence. Why: fast start, steady iPhone volume, Theo never hears himself.
- Theo memory fingerprints come only from _shared/embeddings.ts (real embedding model, 768 dims); never ask a chat model for vectors. Why: chat-made vectors are random, so memory search returned unrelated notes.
- Theo actions: ai-assistant only proposes (voice + chat, never bake-off), never writes; the only write is the tap in the one wizard src/components/ai/theoWizard.tsx (owned by the chat bubble) via quickTasks.ts or scheduleActions.ts; previews logged in theo_action_log (source). Who gets what: only _shared/theoActions.ts. Why: no save without a tap; one card.
- Shift reassign + published-week Update (change log, one "Schedule Updated" push, snapshot refresh) live only in src/lib/scheduleActions.ts, used by the Schedule page and Theo (draft week: move only). Why: one save path, identical notices.
- Who can cover a shift: only _shared/coverCandidates.ts (time off, availability, already working; role tag is a flag); server mirrors _shared/availabilityMirror.ts and _shared/appRoles.ts stay equal via src/lib/coverCandidates.test.ts. Why: the app checks, Theo only reads.

- Theo add/delete shift rules + day preview: only _shared/shiftPlan.ts (checked at preview and tap); writes only in src/lib/scheduleActions.ts. Why: one rule, one save path.
- Theo messages (read my chats, reply, new DM): all chat reading goes through the asking person's own access plus the one store/membership filter (_shared/messagePlan.ts scopeChats), and the only sends are src/lib/chatMessages.ts (sendChatMessage with its push, findOrCreateDm for Theo only, unsendMessage), shared with the chat window. Why: Theo must never see a chat the person isn't in, and a message must send one way.
- Theo clock in/out: rules only in _shared/punchPlan.ts (preview, tap, Undo); every punch insert goes through src/lib/punches.ts; clock-out never sends a shift_id. Why: one rule, one save, and in/out stay on the same shift.
- Quick Nudge: _shared/nudgePlan.ts + *_nudge_status; who's clocked in only via _shared/onClock.ts (Toast stores: open paired toast_shifts); quickNudges.ts → quick-nudge; nudge_log; NUDGE_ICON. Why: one path; Toast stores have no time_punches.
- POS list: server only _shared/posSources.ts, client only src/lib/pos/liveSales.ts; never a hard-coded fallback POS (unknown = null). Why: missing lists mislabeled Hayward.
- New data/POS source: update data_point_registry in the same migration. Why: one writer map.
- Schedule pay: weekLaborCost=labor_week_pay, fixture-checked, no meal premium. Why: 1 cost.
<!-- LOVABLE:BEGIN -->
- Settings mode uses useStationMode + ScheduleOrganizeBy for one query/save; sales goal display stays separate from labor denominators. Why: prevent drift.
<!-- LOVABLE:END -->
- Manager-added duplicate punches (a second clock-out on a closed shift, an overlapping/duplicate break) are blocked only by the time_punches BEFORE INSERT trigger trg_zz_guard_manager_duplicate_punch (skips kiosk/self, auto punch-out and created_by NULL); manager edit screens re-check the shift and map errors via src/lib/punchEditGuard.ts. Why: two managers or a manager plus the kiosk must never double-punch a shift.
