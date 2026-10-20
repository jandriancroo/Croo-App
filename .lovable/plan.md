# Phase 3 — STEP 0 report (no files edited, waiting for "go")

## A. Header and dock spacing (phones)

1. Heights (read from code, not yet measured on screen — first build step is a 390px measurement with a 34px bottom inset):
   - Header: `Layout.tsx:1104-1109`, fixed, `h-14` (56px) + safe-area-top. `<main>` (`Layout.tsx:1497`) starts content at safe-area-top + 52px, so the top ~4px of every page sits under the header.
   - Dock: `nav.mobile-dock-container` (`Layout.tsx:1507`, CSS `index.css:1381`) is `position: fixed; bottom: 0`. Its height comes from DockContent. `<main>` keeps 96px (`pb-24`) at the bottom, which doesn't include the 34px home-bar inset. So with the inset, the last ~2px sit under a 64px dock, and more when the sales/labor handle is showing.
2. Pages at risk: every phone page that uses Layout's `<main>` has the same 4px overlap at the top. At the bottom, the risk is the last row of long pages (Dash, Tasks, Schedule, Time Tracking, Settings, Messages) when the handle is up. A per-page list needs the on-screen measurement. That's the first build step, and I'll report it before changing anything.
3. Floating elements on or behind the dock (phones):
   - `support/SupportButton.tsx:19` `bottom-24`: support files are locked, so I'd list it only and not edit it.
   - `users/BulkActionsBar.tsx:26` `bottom-6` (no phone offset): sits behind the dock.
   - `hiring/BulkApplicantActionsBar.tsx:34` `bottom-20`: overlaps a dock with the inset.
   - `brand/BrandCatalogBulkBar.tsx:95` `bottom-24`.
   - `org-dashboard/OrgTotalsBar.tsx:57` `mb-20` + safe-area.
   - `schedule/MobileScheduleView.tsx:1701` share button `bottom-4`: sits on the dock (removed in D).
   - Also found: `inventory/InventoryItemsManager.tsx` 2135/2252/2300, `inventory/LiteInventoryItemsList.tsx` 840/932/982, `inventory/recipe-catalog/BulkReassignBar.tsx:59` (locked, list only). `punchclock/ThemeToggleIcons.tsx`, `SwipePagerHint.tsx` are kiosk screens with no dock (leave).
4. Fix: in Layout, add a ResizeObserver on the mobile `<header>` element and on the `nav.mobile-dock-container` wrapper (both outside DockContent 61-259). It writes `--app-header-h` and `--app-dock-h` on `<html>`. `<main>` then uses those for its top and bottom padding on phones, and the unlocked floating bars use `bottom: calc(var(--app-dock-h) + 12px)`, with the current values as a fallback. The observer watches the wrapper, so the handle growing changes the height automatically. **No edit inside DockContent is needed.**

## B. Dash: move the Edit Dashboard button
1. Current button: `src/pages/Dashboard.tsx:621-633`, the `PageTitle` action (ghost icon `Settings2`, `setShowEditDashboard(true)`). The dialog is mounted at `Dashboard.tsx:645`. The move only puts a new Button (outline, h-11, rounded-lg, full width, sliders icon, "Edit layout") under the Sales Summary block, with the same `setShowEditDashboard(true)`. **No edit to EditDashboardDialog.tsx.**
2. Who sees it: shown only when `!shouldUseRoleCubes`. I'll use that exact same condition, so who sees it doesn't change.

## C. Dash section titles (current strings)
- `WidgetsSection.tsx:611` "Promo"
- `WidgetsSection.tsx:578` "Cubes"
- `ChecklistsGrid.tsx:153` "Checklists" (plural, matches the code comment)
- `QuickTasksSection.tsx:25` "Quick Tasks" → becomes "Tasks"
- `WidgetsSection.tsx:672` "Summary"
- No singular/plural mismatch in the titles. The comment in DashSectionTitle.tsx says "CHECKLISTS", and that also matches.

## D. Mobile Schedule split action button
1. Who sees the bar today (`MobileScheduleView.tsx:1104-1165`). The comment says "always visible", and it has no role check around it:
   - **Quick Punch:** shown to EVERY role, including regular staff, whenever the store isn't a Toast-labor store. It's greyed out unless the selected day is today. So the owner's belief is wrong: staff and shift managers DO see the bar, with only Quick Punch in it.
   - **New Shift, New Event:** `isAdmin || isManager` AND `scheduleId`.
   - **Build Week:** `isAdmin || isManager`.
   - At a Toast store (Coop's), staff and shift managers see an empty teal strip.
   - **Decision needed:** keep Quick Punch for every role, matching today, or limit it?
2. Title row: the phone Schedule has no page title. The top row is the week navigator plus the week badge (`MobileScheduleView.tsx:~835-845`). Proposal: put the split button at the right end of that row, and let the badge drop under the date range if space is tight. Fit at 390: date range (~150px) + badge (~70px) + split button with "Build Week" (~150px) ≈ 370px of ~358px usable. That's tight, so the badge may need to wrap or shrink. I'll confirm on screen during the build.
3. Share PDF:
   - The print helper builds a full HTML page and writes it into a new window. It doesn't return the HTML. Plan: split it into `buildSchedulePrintHtml(data)` (pure) plus the existing open-window wrapper, so desktop Print stays identical. Then render the HTML off-screen, take a picture of it with html2canvas, and place that in a landscape jsPDF page. No hand-built jsPDF layout.
   - The phone view gets the same data the desktop print uses, built the same way from the props Schedule.tsx already has (a small helper shared by both).
   - `navigator.share({ files })` works in the installed iOS home-screen app (iOS 15+) when `navigator.canShare({ files })` is true. Otherwise it downloads the PDF. iOS may open that in a preview rather than save it.
   - Unpublished schedules: desktop Print prints all loaded shifts with no published/draft filter (`exportSchedulePrint.ts` has no status check). **Decision:** Share PDF on an unpublished week would hand out draft shifts. Block it, add a "Draft" label, or match desktop?
4. Removed only: the teal bar (1104-1165) and the floating Share button (1690-1708), plus the now-unused `handleShare`/`shareCopied` link-share code. Quick Punch, the New Shift sheet (same `setAddSheet*` calls), the Build Week wizard and the New Event dialog open through the same state setters. QuickPunchDialog is not edited. The small Build Schedule icon at line ~893 stays.
   - Default action as specified: Quick Punch (non-Toast store and today), then New Shift (schedule exists, manager+), then Build Week (manager+).
   - For staff, today, at a non-Toast store: the only action is Quick Punch, plus Share PDF in the menu. On other days the default is greyed Quick Punch, or Share PDF as the default — which one?
   - The split button uses the accent token for "orange", which isn't orange in every theme.

## Decisions needed before "go"
1. Should Quick Punch stay visible to all roles, as it is today?
2. Share PDF on an unpublished week: block, label as draft, or match desktop?
3. Staff on a non-today day: should the default be Share PDF or greyed Quick Punch?
4. SupportButton and the inventory bars are locked. Should they stay unchanged, even though they overlap the dock?
