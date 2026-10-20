# Phase 4 — One page title, same height everywhere: STEP 0 report

Report only. No project files were edited and nothing was built. I worked out the heights below from each page's own sizing settings and didn't open the app, because measuring would mean running a script that saves screenshots and you asked for no file-writing scripts. Once you say "go" I'll take real 390-wide measurements before changing anything.

## Today's shared title

- The outer box is `mt-4 md:mt-3`: 16px above on phone, 12px on iPad/desktop. Nothing is set below it, so the gap under the title comes from each page.
- The title row is `flex items-center justify-between` with no minimum height. The text is 29px, `leading-none`, so a title on its own makes a 29px row.
- The action slot has `[&_svg]:size-[23px]`, which forces every icon to 23px.
- Shared button sizes: `icon` = 44px round, `default` = 44px, `sm` = 40px, `lg` = 48px.

## 1. Pages using the shared title (16 places in 14 files, plus Inventory)

| Place | Action beside it | Spacing changes | Row height at 390 (worked out) |
|---|---|---|---|
| Dashboard.tsx:620 | none | parent `space-y-1` (4px below) | 29px |
| Messages.tsx:67 | icon Button forced to `h-12 w-12 rounded-2xl` (48px) | parent `pb-8` only | 48px |
| LogBook.tsx:95 (Library view) | none | parent `space-y-4` | 29px |
| LogBook.tsx:106 | icon Button outline, 44px (admin, search tab only) | wrapper `mb-4` | 29px or 44px depending on tab and role |
| Tasks.tsx:68 | none in the slot; the TabsList (History/Edit) sits under it in a `space-y-3` stack; a % circle sits beside the stack with `mt-4` | wrapper `mb-4`, `items-start` | about 29 + 12 + 40px stack |
| Settings.tsx:520 | none; subtitle `<p>` under it | parent `space-y-4` | 29px |
| MyTeam.tsx:108 | none; subtitle under it | `space-y-4` | 29px |
| MyTimecard.tsx:49 | none; a subtitle + `icon-sm` arrows row sits under it | `space-y-4` | 29px |
| UserManagement.tsx:30 | none | `space-y-4` | 29px |
| Billing.tsx:131 | none; subtitle under it | `space-y-6` | 29px |
| Availability.tsx:69 | not in the slot: a "Request Time Off" Button (default, 44px) is a sibling in a `flex-wrap gap-4` row | `space-y-4` | 44px (row) |
| Alerts.tsx:514 | not in the slot: a 32px Radio icon on the left, subtitle under it; "Report Bug" outline `sm` (40px) as a sibling, super admin only | custom row | about 29 + subtitle |
| Certifications.tsx:334 | not in the slot: a back arrow on the left, subtitle under it; a cards/table toggle (2x `icon-sm`, bordered) as a sibling | custom row | about 29 + subtitle |
| Changelog.tsx:117 | not in the slot: a back arrow on the left, subtitle under it; "Add Entry" Button (default, 44px) as a sibling | custom row | about 29 + subtitle |
| MobileScheduleView.tsx:821 (staff) | none | parent `space-y-0.5` | 29px |
| MobileScheduleView.tsx:1046 (manager) | ScheduleActionSplitButton, 44px pill | `className="mt-0 [&_h1]:my-0"`, scroll area `pt-3.5` | 44px |
| **Inventory.tsx:681 (LOCKED, waiting on your unlock call)** | not in the slot: store name subtitle under it; outline/icon Buttons as siblings | wrapper `pt-4`, `items-start` | about 29 + subtitle |

## 2. In-app pages with their own title (no shared title)

| Page | Current title | Next to it |
|---|---|---|
| BrandDashboard.tsx:359 | h1 `text-3xl bold` "Brand Dash" | brand/store controls |
| BrandAutoDeployLog.tsx:84 | h1 `text-2xl semibold` | none |
| BrandPackConfigApprovals.tsx:1227 | h1 `text-2xl` (`text-base` when embedded) | filters |
| BrandUnpricedIngredients.tsx:115 | h1 `text-xl` (embedded `text-base`) | back button |
| COGSReport.tsx:604 | h1 `text-lg semibold` | date/period pickers, export |
| CreateChecklist.tsx:428 / EditChecklist.tsx:909 | h1 `text-xl bold` | back + save buttons |
| CompleteChecklist.tsx:1228 / SubmissionDetails.tsx:112 | h2 `text-3xl` (the checklist name) | back button, status |
| DynamicChecklistCalendar.tsx:615 | h1 `text-xl sm:text-2xl` | back button, month arrows |
| Hiring.tsx:502 | h1 `text-2xl bold` | tabs / filters / search |
| HiringChat.tsx:427 | h1 plain (org name) | chat header (leave as is) |
| InventoryCount.tsx:337, LiteInventoryCount.tsx:169 | h1 `text-xl` | count controls (inventory, LOCKED) |
| LocationProfile.tsx:416 | h1 `text-2xl sm:text-3xl` + icon | edit buttons |
| MultiLocationDashboard.tsx:243 | h1 `text-xl md:text-2xl` | store/date filters |
| PayrollReview.tsx:166 | h1 `text-3xl` "Payroll Period" | period picker, approve/export |
| PunchClockCustomization.tsx:630 | h1 `text-2xl sm:text-3xl` | save (manager settings, not the crew kiosk) |
| QRCodeGenerator.tsx:37 | h1 `text-2xl` | none |
| ScheduleSettings.tsx:324 | h1 `text-2xl sm:text-3xl` | back button |
| ShiftTemplates.tsx:328 | h1 `text-3xl` | add button |
| TemperatureValidation.tsx:260 | h1 `text-3xl` | filters |
| TestingChecklist.tsx:172 | h1 `text-2xl` | none |
| UsageModelsPage.tsx:83 | h1 `text-xl` | none |
| WeekTemplateBuilder.tsx:1007 | h1 `text-2xl` | save, week controls |
| InstallGuide.tsx:13 | h1 `text-3xl` | none (help page) |
| Schedule.tsx (desktop), MyProfile.tsx, ApplicantPortal.tsx | no page-level h1 found | desktop Schedule uses its own toolbar |

Left out on purpose: access-denied/not-found screens (BrandInventory:372, BrandManagement:199, OrganizationProfile:150, SuperAdminPlans:359, JobDetail:77, QRQuickTaskReport:156), the PunchClock kiosk, Home/marketing, the auth pages, and section headings inside Reporting.tsx:555. I only skimmed what sits beside each title (I didn't open every file in full). I'll check each page as I convert it.

## 3. Pages that can't fit the pattern as-is

- **Tasks**: the tabs and % circle share the title area. Proposal: title row gets the % circle as the 44px action (it's display only) and the tabs move to the row under it.
- **Alerts, Certifications, Changelog, Inventory**: back arrow on the left and a subtitle under the title. Proposal: the back arrow stays on the left, outside the title. The subtitle moves to the row under the title. The right-side buttons go into the action slot at 44px. Certifications keeps its 2-button toggle as one 44px row.
- **Availability**: the button is a sibling. It moves into the action slot (default 44px).
- **Hiring, COGSReport, MultiLocationDashboard, PayrollReview, TemperatureValidation, BrandPackConfigApprovals, WeekTemplateBuilder**: filters, tabs, date pickers or search sit in the title area. Proposal: title plus at most 2 buttons on the title row; everything else moves to the row under it, unchanged.
- **Embedded pages** (BrandPackConfigApprovals, BrandUnpricedIngredients when embedded): keep the small heading when shown inside another page; use the shared title only on the full page.

## 4. iPad (1024) and desktop

- One fixed 44px row, 29px text and 44px actions work at every width. The only width difference left would be the gap above (`md:mt-3`, now 12px vs 16px). I'll take that out so every width gets the same gap, unless you'd rather keep it.
- Pages that use `text-3xl` on desktop today (BrandDashboard, PayrollReview, ShiftTemplates, TemperatureValidation) will get slightly smaller titles (30px to 29px). No `md:` variant is needed.
- Long titles (for example "Plans & Billing", "User Management", "Pack Config Approvals") with 2 actions at 390: the title needs `min-w-0 truncate`, or it will crowd the buttons.

## 5. Risks

- **Messages**: its action is 48px today. Bringing it down to 44px makes the chat bubble smaller (that's the look change, nothing else).
- **Phone Schedule (manager)**: it sits inside a scroll area with `pt-3.5`. The shared top gap must not add to that, or the earlier tightening comes undone. The title-row height stays the same (44px).
- **Pages that are 29px today** (Dash, Settings, MyTeam, etc.) grow by about 15px. This pushes content down a little. None of them has a sticky header under the title. The only sticky header found is Inventory.tsx:815 (a sub-view, locked).
- **Taking away the forced 23px icon size**: Messages (`h-6 w-6` = 24px) and LogBook (default icon size) will change slightly. The Schedule split button already sets its own 18px icons.
- **Locked list**: Inventory.tsx:681, InventoryCount, LiteInventoryCount and BrandInventory are in it. No changes are planned to them until you decide. DockContent, components/dock, the cubes, EditDashboardDialog, the toasts, WeeklySummaryEntry, support tickets, punchclock/timeclock and the Nudge files aren't touched by any page above.

## Questions for you before "go"

1. Inventory: unlock just its title row, or leave it out?
2. Same gap above the title at every width (drop `md:mt-3`)?
3. Tasks: OK to move the History/Edit tabs below the title and put the % circle in the action slot?
4. This phase: only the 16 shared-title places, or also convert the pages in section 2?

Waiting for "go".
