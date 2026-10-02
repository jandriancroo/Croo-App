# Roadmap

## In progress
- [ ] Per-till expected cash fix: fetch individual QU till rows (AM/PM), match to the count instead of summing the day; keep live fallbacks; never $0.
- [x] Hiring inbox parity: DM-style preview/date/unread rows and delete inside the open conversation.

## Recipe costing fix (unlocked Sep 30)
- [ ] Brand→store recipes Gate 1: costing uses store pack (lens) — preview built, 0 cost changes; awaiting approval to switch
- [ ] Gate 2: brand Recipes tab brand-only (no store picker, median pricing, outlier flags) — waits on Gate 1
- [ ] Gate 3: brand cleanup table, Jordan picks per row — waits on Gate 2
- [ ] Brand→store sync + pans — after PS/PD count
- [ ] Step 1: store counters read pack data, loud failure, server dry-run calculator — awaiting Jordan's table approval
- [ ] Step 2: write costs + reset store yields to brand yield (together), clear orphaned blended prices, nightly schedule
- [ ] Later phases: editor stops writing cost/pack, recipe case-multiplier reset, raw items use store pack

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
- [ ] Toast labor must reach: cubes (no cube code change), sales summary dash, dynamic dash (mobile + punch clock), mobile schedule page — shift cards identical to today's, plus a small Toast icon; active shift cards not editable, adding shifts still allowed
- [x] Sales summary says "Updated from Toast" for Toast stores
- [ ] Toast labor pairing (APPROVED Sep 28 1:27 PM PT; "toast" tag added to labor records) — next: pull punches, match to schedule, late alerts, labor %
- [x] Answer: are 3D Data Cubes POS-agnostic and buildable from any POS sync? (audit cube data sources — yes, cubes read shared sales/labor caches, zero cube changes needed)
- [x] TOTP secret rotated (new authenticator key saved; sign-in verified end-to-end)
- [x] GitHub Actions secrets added by user (TOAST_LOGIN_EMAIL/PASSWORD/TOTP_SECRET)
- [x] Toast live robot (toast-live-runner.mjs + workflow) — sign-in OK, report poll fixed
- [ ] Verify first full live run post-rotation: sign-in → sales poll → toast-sync ingest
- [ ] Plan remaining sales sync + labor (backfill daily -364d, hourly -7d; labor pairing read-only 'toast' source — needs user sign-off)

## Toast labor pairing (in progress, Sep 28)
- Coop's org has almost no CrooHQ users yet (only Sam & Debbie) — Toast↔CrooHQ matching runs on names; unmatched punches show with Toast names, alerts/wages unlock as profiles are added. Do not block on this.
- [x] Migration: toast_employee_mappings table + pull_labor=true for Coop's Toast integration
- [x] toast-sync ingest-labor action (deployed)
- [x] Robot: punch-pull code added (template replay via toast-shifts-request.json; capture reordered before live poller — pending capture run + first ingest test)
- [x] Mobile schedule: Toast punch cards (read-only, Toast icon; build OK)
- [x] Manager dash overlay: who's on the clock from Toast (toast_shifts IN_PROGRESS, Toast badge, mapped users get scheduled times)
- [x] Saved Toast staff links immediately update existing mobile shift cards; current paired shifts backfilled
- [ ] Nightly Toast export pull (SFTP) — deferred

## Toast hourly history (queued Sep 28)
- Current daily backfill strips hourly detail for days > 7 old — projections (4-week hourly pattern + last-year hourly) need hourly for the full year.
- Plan: chained background job — wait for daily backfill to exit → re-run 371-day pass with hourly kept for every day (same 'api' source, overwrites hourly_data) → then capture GetShiftsV2 punch request for the labor robot.

## Live freshness fix (Sep 28)
- User saw stale sales ($1,527 @ 2:02 vs Toast $1,725): the 6-hour GitHub cron leaves afternoon gaps. Reordered the chained queue: after daily backfill → LIVE poller (90s, through close, MAX 420 min) → hourly-history pass (371d, HOURLY_ALL=1) → punch capture. Also plan: tighten GitHub cron for overlapping day coverage.

## Freshness clarification (Sep 28)
- get_live_labor_totals migration: when labor source is 'toast', returns labor_cache toast rows via _store_labor instead of punch math. Dashboard labor% card then works as soon as the robot ingests punches.
- Explained to user: 90s = poll interval while robot runs; between scheduled runs numbers freeze. Queue now wakes the poller after backfill through close; next step is covering all store hours (cron window review).
- [ ] Toast live sales alongside history — blocked on Toast sign-in code rejections
- [ ] Toast punches for On the Clock — after live sign-in works

- [x] Toast pay rates: pulled from Toast employee list (58 people, 13 on today's punches); salaries skipped
- [ ] Toast robot permanent all-day schedule (still runs from workspace only)
- [x] Replace raw virtual interview links in calendar files with signed CrooHQ redirect links and verify downloads.

## Toast robot reliability (Sep 29, approved)
- [x] Robot check-ins + 4/day sign-in cap + handoff
- [x] Watchdog every 5 min: restart + alerts (verified: alerts sent 19:10/19:15 UTC)
- [x] "Toast data delayed" on dashboard + mobile schedule
- [x] Auto-restart live: watchdog now dispatches via GitHub connector (GITHUB_API_KEY + GITHUB_REPO saved; dispatch verified 204 Sep 29)

## Queued
- [ ] Post-inventory: credit-waste review (which background jobs/queries burn the most) — Jordan wants to trim before spending on bigger compute.

- [ ] Bottled beer at Palm Springs: cost/packs wrong. Revisit in next few days — Jordan may build a beer product/order sync (most stores order monthly).

## Oct 1, 2026
- [in-progress] Redesign sales summary scoreboard layout (sales/Goal swap looked messy) — preview layout options, then implement Jordan's pick.
- [in-progress] Reduce the centered sales scoreboard tile height while preserving the approved layout.
- [in-progress] Move the Today sales sync timestamp below the hourly sales chart.
- [in-progress] Label the Pace comparison explicitly as versus last year.
- [in-progress] Make each Pace stat tappable: show the LY percentage by default and reveal percentage, dollars, and arrows in a compact popover.
- [x] Sales card: show Pace vs Last Year comparison as a badge

## In progress
- Sales summary scoreboard (Option B): center the status pill over the progress bar with a "cutout" (ring in card color), make the pill slightly larger, and raise Last Year + Pace numbers to Goal's font size. Comp badges below data points already done. File: src/components/dashboard/SalesSummary.tsx renderScoreboard.

## In progress (Oct 1, 2026)
- Sales scoreboard: reduce hero number ~15% (44px -> 37px), style pace comp popover trigger as a clickable badge with a small open icon.
- Pace popover styling must match the hourly chart popover design (white card, bold title, label/value rows) per Jordan.

## Theo voice (Oct 2)
- [x] Phase 1 live voice screen, 4-hour openers, talk button
- [ ] Jordan to test on his phone (mic + sound)
- [ ] Track text-Theo AI usage (tokens/cost) per user and store in Theo Usage
