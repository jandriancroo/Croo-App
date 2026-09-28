# Roadmap

## In progress
- [ ] Per-till expected cash fix: fetch individual QU till rows (AM/PM), match to the count instead of summing the day; keep live fallbacks; never $0.
- [x] Hiring inbox parity: DM-style preview/date/unread rows and delete inside the open conversation.

## Open
- [ ] Overnight fill-in: after QU reconciles the closing till, fill expected cash for counts saved with no/blank expected.
- [ ] Backfill the 54 Tuscaloosa nights (and any SM gaps) with QU per-till expected figures — needs approval before writing history.
- [ ] Deposit single-system rule: deposits happen either in CrooHQ or in the POS, not both. Decide detection/UX (e.g., notice when a store deposits in QU) and guidance.
- [ ] Pre-existing security findings (28) still awaiting user review.

## Hiring interview modalities + comms (Sep 24)
- [x] In person / Virtual / Phone in schedule dialog; link stored on application
- [x] Link on email, calendar file, chat bubble, profile, list, Interviews calendar
- [x] Bulk Interviewing → schedule dialog; list "Send interview invite"
- [x] Profile Cancel (stays Interviewing) + Reschedule (prefilled)
- [x] Accept / decline / ask-for-new-time → staff email + push
- [x] Staff chat messages no longer email applicants

## Pack 2B Step 1 (approved Sep 26 4:51 PM PT)
- [x] Server: pairing refactor, labor_shifts, resolutions, open issues + close guard, get_store_labor gates
- [x] D3 per-org role settings (schema, templates, seed, RLS, pulses)
- [x] Andy vendor-invoices storage policies
- [x] send-push-notification org-aware redeploy
- [x] D3 client filters (5 files)

## Package A (approved Sep 26 7:42 PM PT)
- [x] 0 snapshots · 1 schema · 2 data fixes · 3 logic · 4 triggers · 5 labor deploys · 6 V0 · 7 recompute · 8 V1–V7 · 9 A-SEC

## Package B-1 (approved Sep 26 10:16 PM PT) — log-only auto clock-out
- [x] Backups, settings, log, detail + wrapper (V2), run_auto_clock_out, B7, cron
- [x] V1, V3, V4, V6 (R4 safety), V7; first cron run counts; 0 'auto_clock_out:' punches
- [ ] B-2 (live + unschedule job 240) — waits on Jordan after the log-only night

- [x] Bundle Stages 0–4 done 9/27 night (backups, Andy fix, Aloha business day, Who's Out nightly, OT premium)
- [ ] Bundle Stage 5 (sales/pace server) — keep fetch-qubeyond-sales tips + today upserts (sync-live does not write tips)
- [ ] Bundle Stage 6 (backfills) · Stage 7 (one frontend publish; cube unlocked for Last Year value/label, re-lock after)

- [ ] Time Tracking mobile day bar: "📅39.5/36.4" compact hours, fix cramped header; Theo note collapses to 2 lines with tap to expand
- [ ] Toast (homemade) for Coops: step 1 table/functions/settings card (in progress); step 2 nightly export robot; step 3 live robot
