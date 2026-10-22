# Roadmap

## Held
(none)

## In progress
- Toast Status public downloads: blocked by workspace public-bucket restriction. Owner/admin must allow public buckets under Settings → Privacy & Security, then make toast-status-releases public. Release publishing deliberately returns 503 until then.

## Done (Toast Status v2)
- Added service-only tokens/restart tables, public release metadata, atomic restart RPC, scoped native-only toast-status function and tests. Deployed; 10 tests passed and live empty 401/404/405 + no-CORS checks passed. No tokens inserted; authorized live flows wait for owner-supplied tokens. Existing Toast, punch, kiosk, payroll and frontend unchanged.

## Done (Oct 21 late)
- System alert top photo/video upload; System Alerts page title matches other pages; Settings tab bar spacing.
- Announcements pop up on Dash after system alerts (read via Chat or popup, optional required "I've read this", who's-read list, out of Quick Tasks). Not yet tried live with test data.

## Done
- System Alerts: reusable theme/feature/system popups with optional training video; super-admin draft/preview/ship/retire screen in Settings. Private live delivery/dismissal/reload/retirement verified, test alert deleted, eight tests passed, build clean. Old Spookify invite no longer mounted; public rollout of app changes not requested.
- Corrected clearance beneath the teal header on run list and completed review; phone and iPad verified, with 8px before the progress bar.
- Review-screen spacing tightening (Oct 21): flat separate cards (no nested wrapper), compact header (~52px), completed-by card without uppercase label, 4-across photo tiles, 48px buttons; verified temp/photo/check at phone + iPad, test data deleted.
- Finished rows final layout (option 3 + read-only completed view, Oct 21 spec): one-line done rows (24px check, 16px bold title, temp/number reading right-aligned, 52px time, 40px avatar, chevron); read-only review with Completed-by card, Reading card (Edit reading for temp), temp photo 96px thumb / photo grid / note text, Retake + Undo buttons, permission-gated footer note; "Worked on by" line above Add notes sorted by items completed. Verified phone 390 + iPad 834, undo-from-review returns to list, test data deleted.
- Progress bar turns success green at 100%, teal below; verified 6/6 green and 5/6 teal.
