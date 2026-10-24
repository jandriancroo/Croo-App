# Roadmap

## Held
(none)

## In progress
- Shift marketplace + support chats batch (Oct 23): built, waiting for Jordan's "ship". Not published.
- Toast Status public downloads: blocked by workspace public-bucket restriction. Owner/admin must allow public buckets under Settings → Privacy & Security, then make toast-status-releases public. Release publishing deliberately returns 503 until then.

## Done (Toast Status v2)
- Added service-only tokens/restart tables, public release metadata, atomic restart RPC, scoped native-only toast-status function and tests. Deployed; 10 tests passed and live empty 401/404/405 + no-CORS checks passed. No tokens inserted; authorized live flows wait for owner-supplied tokens. Existing Toast, punch, kiosk, payroll and frontend unchanged.

## Done (Oct 21 late)
- System alert top photo/video upload; System Alerts page title matches other pages; Settings tab bar spacing.
- Announcements pop up on Dash after system alerts (read via Chat or popup, optional required "I've read this", who's-read list, out of Quick Tasks). Not yet tried live with test data.

## Done
- Duo-open follow-up: both cubes 140px, intrinsic faces with no flex-fill, balanced content/dots; all eight faces readable at 951px/84px. Below-bar gaps 14px on both panels, Schedule title x507.5 aligns with content; Dash title retains icon clearance. Phone/folded unchanged; nine tests passed; nothing published.
- Duo Part B: Layout slots receive existing Dash/Schedule PageTitle trees; white 30px titles, 72px+inset bar, Theo below. At 951px/84px: left 106–455.5, right 495.5–855, panels start y72. Punch/New Shift open correctly; Settings in-page title and phone/folded titles preserved; nine tests pass. No locked file edits or publishing.
- Open Duo cubes: content-sized equal heights, all eight faces verified signed-in at 951px/84px column with no text overlap/clipping; phone/folded/iPad/desktop sizing unchanged. Only DataCube3D presentation changed; no publishing.
- Duo native header controls: open header shows only brand/location text; native location/Theo/Nudge events verified signed-in at 951px/84px column. Late badge shares existing Nudge query; panel edges 495.5–867px, outside/Escape/toggle verified. Seven tests passed, normal-device/folded checks passed. Part B title placement remains report-only; nothing published.
- Duo open Nudge: right-panel bounds measured 495.5–867px at 951px/84px column; outside tap, Escape, finger toggle and 44px close verified signed-in. Folded presentation and sending logic unchanged; nothing published.
- Duo crease alignment: panels and header share 50vw minus the left column and half the gutter; signed-in 951px preview with 84px right column measured edges 455.5px/495.5px, 40px empty gutter, header groups aligned, no page errors, and Duo-off restored. Build clean; nothing published.
- Duo follow-up: straight edge-to-edge headers, native profile event opens mobile menu in both modes, startup class observation gap covered by four passing tests. Signed-in preview verified open Dash/Schedule panels and independent scroll, both menus, and unchanged non-Duo header measurements at phone/iPad/desktop. Real-device missing split was not reproduced; no hiding/stacking conflict found. Nothing published.
- Menu sheet rows (Oct 23): Sign Out now shares the bottom row with Settings; Update button widened into the freed space with a green arrow icon. Quick Fill (shift edit dialog) shows one full line — "AM Manager · 9:00 AM – 4:00 PM" — instead of the clipped two-line option; "None" shows as None. Phone-verified; New Shift sheet uses the same fix but wasn't reached live. Typecheck and build clean; nothing published.
- Presentation/navigation polish: Events gaps retained, equal punch-input columns, compact expandable sandbox row, larger menu, and manual Settings tour entry. Typecheck and navigation tests passed; no publishing or data changes.
- Marketplace Assign/Approve/Undo now update only the selected published shift atomically; repaired Jaysen's Hemet Saturday assignment and verified it live on the phone schedule without draft styling. Other published shifts unchanged; 4 isolated SQL regression tests and 13 marketplace tests passed. No app publishing, punch, kiosk or cache changes.
- System Alerts: reusable theme/feature/system popups with optional training video; super-admin draft/preview/ship/retire screen in Settings. Private live delivery/dismissal/reload/retirement verified, test alert deleted, eight tests passed, build clean. Old Spookify invite no longer mounted; public rollout of app changes not requested.
- Corrected clearance beneath the teal header on run list and completed review; phone and iPad verified, with 8px before the progress bar.
- Review-screen spacing tightening (Oct 21): flat separate cards (no nested wrapper), compact header (~52px), completed-by card without uppercase label, 4-across photo tiles, 48px buttons; verified temp/photo/check at phone + iPad, test data deleted.
- Finished rows final layout (option 3 + read-only completed view, Oct 21 spec): one-line done rows (24px check, 16px bold title, temp/number reading right-aligned, 52px time, 40px avatar, chevron); read-only review with Completed-by card, Reading card (Edit reading for temp), temp photo 96px thumb / photo grid / note text, Retake + Undo buttons, permission-gated footer note; "Worked on by" line above Add notes sorted by items completed. Verified phone 390 + iPad 834, undo-from-review returns to list, test data deleted.
- Progress bar turns success green at 100%, teal below; verified 6/6 green and 5/6 teal.
- [x] Dock dashboard gradient cap (presentation only)
- [x] Duo phase 1: useDuo hook, duo CSS contract, open/folded headers, Dash+Schedule split, round Update, popup fixes, 5 named dialogs
- [ ] Duo later phases: Chat, Tasks, Logs, Users/Settings tabs (wait for Jordan's go)
