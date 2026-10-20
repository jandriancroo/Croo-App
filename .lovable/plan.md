# Phase 2B buttons: STEP 0 report (I haven't written any code)

## 1. Shrunk shared Buttons (h-6 to h-9)
I found about 220 of them in about 90 files, after leaving out locked, protected and preview files. Rough split:
- h-6 to h-8 with an icon only: about 45, going to `icon-sm`
- h-6 to h-8 with text: about 120, going to `xs`
- h-9: about 55, going to `sm` (40px)

The full file:line list is saved and ready. Groups that need a decision before anything changes:
- **Layout.tsx, lines 1237 to 1456 (9 buttons).** These sit inside DockContent, which starts at line 61. That's the swipe-up menu, so it's locked. Proposal: skip them.
- **Punch, kiosk and time clock screens.** This covers `punchclock/ManagerDashboardOverlay.tsx` (4), `punchclock/ShiftSummaryCard.tsx`, `timeclock/QuickPunchDialog.tsx`, `schedule/QuickPunchDialog.tsx`, `schedule/EditPunchDialog.tsx` and `timetracking/EditShiftForm.tsx`. Past ships ruled these out. Proposal: skip them unless you say otherwise.
- **pages/Inventory.tsx (1).** This is part of the inventory system, which is locked. Proposal: skip it.
- **Fixed-height rows where 36px going to 40px could break.** The h-9 buttons in these places would go to `xs` (32px) instead of `sm`:
  - `MobileAddScheduleSheet` around line 919
  - `MobileShiftDialog` lines 417 and 435
  - `EditShiftDialog` lines 441 and 459, which are steppers inside a fixed time row
  - `SalesSummary` line 1853
  - `MediaLightbox` lines 66 to 75, the top bar
  - `ShiftOfferMessage` lines 336 and 340, inside a chat bubble
  - `InlineComments` line 229, the send button beside the input
  - `IntegrationsSection` line 1359
  - `StationsManagerCard` line 31
- **MobileScheduleView, lines 895 to 943.** This is a row of 6 h-7 buttons. Going from 28px to 32px may wrap at 390px. I'll check that first.

## 2. Hand-made `<button>`s
I found 380 in 144 files, after leaving out locked, protected and preview files. A first pass by class name sorted them like this:
- (a) Real buttons I'd convert: about 24
- (b) Rows, cards, chips, tiles, swatches and the orb, which stay as they are: about 88
- (c) Unsure: about 262. Most of these are bare icon taps like close, chevron, edit and remove, with no clear button styling.

Notes:
- **theoWizard.tsx (32) and TheoVoiceOverlay.tsx (6):** all of these are (b). They're wizard and orb visuals, so I'll leave them.
- **Layout.tsx (11):** all inside the dock or menu sheet, so they're locked and I'll skip them.
- **LocationPickerDialog (9), MobileAddScheduleSheet (11), TrackerWidget (9), AddWidgetDialog (8):** these are mostly selectable tiles and rows, so (b).
- **Proposal for (c):** given the volume, convert only the (a) group in this phase. The (c) group would get its own short review before Phase 2C.

## 3. Tap-area overlap (32px buttons less than 12px apart)
- `LogBookEntryList` lines 81 to 153: four h-6 icon buttons next to each other
- `ReadAndSignForm` lines 451 to 663 and `ManageReviewItemsDialog` lines 160 and 169: up and down or delete pairs
- `PositionManagement` Compact and Inline, around lines 198 to 270: edit, save and cancel clusters
- `PrepListEditor` lines 173 and 250, and `Option6TodayContent` lines 111 and 147
- `MobileScheduleView` lines 922 and 934: an arrow pair
- `ReactionPicker` line 30 and `GifPicker` lines 101 and 114

This is a report only. Where the invisible 44px tap areas overlap, the button drawn on top wins, so a tap may land on the neighbouring button.

## 4. Protection check
- None of the planned changes touch the Nudge files. NudgeSection, QuickNudgeSheet, QuickNudgeTutorial, NudgeBadge, QuickTaskRow, the quick-nudge code and the Nudge part of Dashboard.tsx all have no h-6 to h-9 Buttons on the list. Their only change will be picking up the new `xs` and `icon-sm` shapes if they already use those sizes, and right now they don't.
- No locked file is on the change list. The dock, cubes, inventory, toasts and support files are all left out.

## Decisions needed
1. Skip the Layout menu buttons (locked dock)?
2. Skip the punch, time clock and inventory files?
3. Use the fixed-row list above (h-9 going to `xs`)?
4. Convert only the (a) group of hand-made buttons and hold (c) for a later review?
