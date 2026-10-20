# Phase 2C: leftover buttons and icon taps. STEP 0 report (no code written)

## 1. Multi-line shared Buttons that 2B missed (32 found)
These are buttons whose tag runs over several lines, so 2B's single-line scan didn't catch them. Proposed mapping: h-6/h-7/h-8 with text go to `xs`. h-9 with text goes to `sm`. h-6 to h-9 icon-only goes to `icon-sm`. The old h-*/w-* class gets removed and the colour classes stay.

| File:line | Now | Proposed |
|---|---|---|
| brand/PendingVendorsCard.tsx:228 | sm h-8 | xs |
| brand/VendorGapFinder.tsx:922 | sm h-7 text-xs | xs |
| brand/VendorGapFinder.tsx:952 | sm h-8, min-w 160 (a dropdown trigger) | xs, width kept |
| hiring/HiringChatPreview.tsx:115, 123 | sm h-8 px-2 | xs |
| hiring/InterviewCalendarDialog.tsx:210 | sm min-h-36 | leave (already grows to fit) |
| hiring/InterviewInviteMessage.tsx:110 | sm min-h-40 | leave (already matches sm) |
| schedule/MobileBuildScheduleWizard.tsx:560 | sm h-8 (cn) | xs |
| schedule/MobileScheduleView.tsx:1433 | sm h-7, amber outline | xs (outside the skipped 895 to 943 block) |
| schedule/ScheduleUndoButton.tsx:43 | icon h-7 w-7 (cn) | icon-sm |
| settings/IntegrationsSection.tsx:1810, 1829 | sm h-8 flex-1 | xs |
| settings/IntegrationsSection.tsx:1881 | sm w-full h-9 | sm (drop h-9) |
| settings/IntegrationsSection.tsx:1939 | sm h-7 text-[10px] | xs |
| settings/IntegrationsSection.tsx:2020 | sm w-full h-8 | xs |
| settings/IntegrationsSection.tsx:2118 | sm, full height inside an input (show-password) | leave (sized by the input) |
| settings/LocationAuditsSection.tsx:733, 752, 849 | sm h-7 | xs |
| settings/LocationAuditsSection.tsx:771 | icon h-7/sm:h-8 | icon-sm |
| settings/OrganizationMembersSection.tsx:291 | icon h-7 destructive | icon-sm |
| users/EmployeeRecordsSection.tsx:323 | sm h-7, absolute next to the sheet close | xs |
| users/I9DocumentsSection.tsx:235 | sm h-7 | xs |
| users/UserManagementTable.tsx:151 | sm h-4 w-4 p-0 (sort icon inside a table header) | leave (see section 3) |
| users/UserManagementTable.tsx:189 | sm h-6 w-6 p-0 | icon-sm |
| pages/Changelog.tsx:160 | icon h-8 w-8 | icon-sm |
| pages/Hiring.tsx:750 | sm h-7 text-[11px] | xs |
| pages/Hiring.tsx:781 | sm min-h-36 | leave |
| pages/Settings.tsx:382 | sm h-auto py-2 (a two-line row button) | leave |
| pages/UsageModelsPage.tsx:284 | sm h-7 | xs |
| pages/WeekTemplateBuilder.tsx:1083 | sm h-auto p-0 (a text link) | leave |
| schedule/QuickPunchDialog.tsx:315 | icon h-9 w-9 | **hold**: this is a punch dialog, so I'm treating it as part of the punch pass unless you say otherwise |

Already done in 2B, nothing to do: the photo viewer top bar (MediaLightbox 66 to 75 is already `icon-sm`). The 6-button schedule row (MobileScheduleView 895 to 943) stays skipped as instructed.

Totals: 24 to convert, 7 to leave, 1 held.

## 2. The 222 unsure hand-made buttons
Sorted by icon:

**(a) Close X: 19.** 15 go to `icon-sm` (chip and tag removers, list-row X), 2 go to `icon` (stand-alone), 2 are left alone.
- Examples: OrgFavoritesBar:84, LocationSettingsSection:339, LocationProfile:592, ScheduleSettings:553, ChecklistHeatmap:437 (icon-sm). PostComposer:173 and PerformanceReviewForm:348 are photo-corner X's and would go to `icon-sm` with their round dark look kept through className.
- Stand-alone `icon`: AiAssistantBubble:542 (Theo panel close, already 40px).
- Leave: EditTemplateDialog:405 and 456. These are 12px X's inside a tiny time or issue chip. A 32px box would break the chip, so they keep their invisible tap area only.

**(b) Arrows and chevrons: 25.** 6 go to `icon-sm`, 2 go to `icon`, 17 are left alone.
- icon-sm: BrandPackConfigApprovals:1390 and 1432, LocationPickerDialog:538 and 557 (brand arrows, h-10 w-8, so these become 32 wide by 32 tall), TrackerWidget:350 and 361.
- icon: MediaLightbox:84 and 115 (side arrows, already 40px round).
- Leave (17): the chevron is part of a full row, header or pill, not a button on its own. That covers LocationPickerDialog:545 and 625, SchedulingPreferencesSection:199, AddWidgetDialog:599, SalesSummary:1427, ShiftSwapBar:20, LogBookNewEntrySheet:873, StationGroupSection:28, Settings:620, CreateChecklist:715, EditChecklist:236, LaborTotals:591, TrackerWidget:384 and 387 (sort headers), and MultiLocationDashboard:257 (round primary toggle, styled on purpose). TrackerWidget:293 and 304 are 16px dots inside a data row and would not fit 32px.

**(c) Edit, delete, remove: 8.** 6 go to `icon-sm`, 2 are left alone.
- icon-sm: PositionManagementCompact:278 and 284, PositionManagementInline:235 and 241, ScheduleSettings:562, InlineComments:148. Their show-on-hover look is kept through className.
- Leave: PostActionsPopover:97 and 110. These are full menu rows with text.

**(d) Other: 170.** About 15 go to `icon-sm`, 1 goes to `icon`, about 154 are left alone.
- icon-sm: the IntegrationsSection:1563 and 1784 show-password eyes, CompleteChecklist:1789, 1817 and 1863 (photo zoom corner), InterviewCalendarDialog:272 (copy), ApplicantFlagSelector:245 (clear), LocationPickerDialog:441 and 508 (default star and the action at the end of a row), and drag handles like EditChecklist:90.
- icon: ChatWindow:167, the scroll-to-bottom button (already 40px round).
- Leave (about 154): these are rows, tiles, cards, chips, segmented toggles, day pickers, text links, reactions, star ratings, GIF and photo thumbnails and calendar cells. Examples: EmployeeRecordsSection:156 (document tiles), PostCard reactions, PerformanceReviewForm:55 (stars), CreateEventDialog day toggles, Auth:281 (carousel dots), and the Availability:102 and 114 view toggles. Swapping these would change how they look, not only their tap area.

The full sorted list stays in the working file and gets attached at build time.

## 3. Fit risk at 390 (report only)
- UserManagementTable:151 and 189: these sit in table header and table cells. A 32px box would make the rows taller, so I'm leaving 151 alone. 189 needs checking.
- TrackerWidget:350 and 361 sit in a fixed-height widget row (20px dots). 32px could push the widget taller, so this needs checking.
- LocationPickerDialog:538 and 557: the brand switcher row is h-10. 32px fits.
- PositionManagementCompact and Inline: edit and delete pairs sit about 4px apart. At 32px the tap areas overlap. The visible boxes fit, but taps may favour the right-hand button.
- IntegrationsSection:1563 and 1784: the eye sits inside the input on the right. The 32px box fits a 40px input. The input's right padding may need `pr-10` (styling only).
- EmployeeRecordsSection:323: an absolute button next to the sheet's X. At `xs` it stays 32px, so no change in risk.
- VendorGapFinder:952 and IntegrationsSection:1810 and 1829 sit in flex toolbars. h-8 becomes 32px, so no change in size.
- Nothing converted to `icon` (44px) sits in a tight row. All 4 `icon` picks are floating buttons that are already 40px.

## 4. Confirmation
- None of these are on the change list: DataCube3D, EditDashboardDialog, Add3DCubeDialog, components/inventory/*, BrandInventory, Inventory, Layout DockContent 61 to 259, components/dock/*, toasts and drawer, WeeklySummaryEntry, support ticket files, punchclock/*, timeclock/QuickPunchDialog, MobileScheduleView 895 to 943.
- None of the Nudge files are on the list either: NudgeSection, QuickNudgeSheet, QuickNudgeTutorial, NudgeBadge, QuickTaskRow, quickNudges, nudgeList.test, quick-nudge, nudgeList and nudgePlan.
- Only className and size props change, plus `<button>` becoming `<Button>`. Every onClick, aria-label, disabled, state and value stays the same. Nothing changes in the database, in queries or in edge functions.
- Side note, not fixed here: the photo viewer still uses `text-white` / `bg-black`, which breaks the theme-tokens rule. It's left as is because it's an always-dark overlay.

## Decisions needed
1. Is schedule/QuickPunchDialog:315 held for the punch pass? (I'm proposing yes.)
2. Are the leave-alone groups above OK, especially TrackerWidget dots and the EditTemplateDialog chip X's?
3. OK to add `pr-10` to the two password inputs if the eye button needs room?
