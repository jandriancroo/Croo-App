
## Vendor sync pipeline (Sep 1)
- [x] One nightly pipeline (vendor-sync-nightly) with stage gating, per-store tasks, retries
- [x] Retire 8h PFG price scrape + duplicate gap scans + standalone PA/pack crons
- [x] Shared price chase (master -> order -> invoice), unpriced/discontinued/ship-in tags
- [x] Targeted resync endpoint (vendor-price-chase) for the "needs price" button
- [ ] UI: "N needs price" counter + Sync button on the item list (next)
- [ ] UI: show discontinued date + ship-in-only badge in item list

## COGS parity (Sep 2)
- [x] Dash list pill honors manual order assignments (match Report Builder / panel)
- [x] Purchases expanded list highlights orders delivered outside the period window

## Punch clock freeze + pairing-until-revoke (Sep 3)
- [x] Durable hashed device secret on punch_clock_devices (migration, no rows touched)
- [x] reissue + backfill_secret actions; redeem returns secret; revoke clears hash
- [x] One shared pairing lock; markPairingBroken retired (server-declared dead only)
- [x] In-session repair-and-retry + bounded punch writes (freeze fix)
- [x] Heartbeat on wake; /version.json + idle cache-busted reload on PIN screen
- [x] Build version stamp on PIN screen
- [x] Replace-vs-add prompt on duplicate device name at code generation
- [x] Locked docs: SHARED_WORKSPACE/punch_clock/pairing-until-revoke.md
- [ ] Publish to croohq.com and verify on a real paired iPad

## Corrective Action (Logs) — Sep 3
- [x] Rename Employee Write-Up → Corrective Action (UI copy only, table untouched)
- [x] Schema: family_id (backfilled), transcript_text, notes_bullets, consent_confirmed_at, recording_duration_seconds, stt_model_used
- [x] Transcript read locked to manager tier via get_corrective_action_transcript RPC
- [x] Recorder: 75s segments, 15 min cap, background auto-stop, audio discarded
- [x] Mini Transcribe (fallback standard) → one Gemini 3.7 Flash bullet pass with names
- [x] Trails: attach to existing issue or start new, reason mismatch flagged
- [x] Bullets + transcript editable until signed_at
- [x] Locked docs: SHARED_WORKSPACE/logs/corrective-action.md
- [ ] Diff review, then publish to croohq.com

## Corrective Action — Sep 4 (PDF + transcript view + notes autofill)
- [x] PDF export: Close/Done button, bullets as one flowing paragraph, overflow-wrap on sections
- [x] Expanded full-height transcript reading view (notes panel + recorder), gates respected
- [x] Autofill empty Reason + Next Steps from recording notes (nullable suggestions from Flash)
- [x] Changelog written
- [ ] Publish to croohq.com and check on the floor iPad

- [x] Commit live `mark_labor_cache_stale_and_backfill` migration + changelog note (2026-09-06)
