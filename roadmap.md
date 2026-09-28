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

- [x] Time Tracking mobile day bar: "📅39.5/36.4" compact hours, fix cramped header; Theo note collapses to 2 lines with tap to expand
- [ ] Toast (homemade) for Coops: step 1 done; step 2 nightly export robot (waiting on Coops SFTP access + sample files); step 3 live robot (waiting on Toast Web login)

## Toast live sync (Coops) — in progress
- [ ] One-time Toast sign-in test (sales + punches for Hayward) — robot signs in via auth.toasttab.com, TOTP from saved secret. Careful: few spaced attempts, avoid account lockout (user explicitly worried).
- [ ] Map Toast Web data feeds (sales summary + labor/time entries) from captured responses.
- [ ] Build 15-minute live fetcher posting to toast-sync (labor scope: read-only Toast punches matched to CrooHQ schedule).

## Toast integration (in progress)
- [x] One-time sign-in test passed (robot signs in end-to-end, no lockout). Findings: docs/toast-recon-2026-09-28.md
- [x] Capture punch-row payload — done: GraphQL GetShiftsV2, full in/out/breaks/job/tips/anomalies/employee IDs (docs/toast-recon-2026-09-28.md)
- [ ] Build live fetcher: reuse session, call report-generator sales/TimeEntry reports every 1–2 min during store hours, POST normalized payload to toast-sync
- [ ] Toast labor must reach: cubes (no cube code change), sales summary dash, dynamic dash (mobile + punch clock), mobile schedule page — shift cards identical to today's, plus a small Toast icon
- [x] Sales summary says "Updated from Toast" for Toast stores
- [ ] Toast labor pairing (APPROVED Sep 28 1:27 PM PT; "toast" tag added to labor records) — next: pull punches, match to schedule, late alerts, labor %
- [x] Answer: are 3D Data Cubes POS-agnostic and buildable from any POS sync? (audit cube data sources — yes, cubes read shared sales/labor caches, zero cube changes needed)
- [x] TOTP secret rotated (new authenticator key saved; sign-in verified end-to-end)
- [x] GitHub Actions secrets added by user (TOAST_LOGIN_EMAIL/PASSWORD/TOTP_SECRET)
- [x] Toast live robot (toast-live-runner.mjs + workflow) — sign-in OK, report poll fixed
- [ ] Verify first full live run post-rotation: sign-in → sales poll → toast-sync ingest
- [ ] Plan remaining sales sync + labor (backfill daily -364d, hourly -7d; labor pairing read-only 'toast' source — needs user sign-off)
