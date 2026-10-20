# Elements upgrade, Phase 1: STEP 0 gate report (no code written)

## 1. Locked-feature impact
| Shared file | Inventory files using it | Support files | Dock / cubes files using it |
|---|---|---|---|
| button | 53 | 4 | Layout.tsx, dock/CompactDashboard.tsx |
| select | 15 | 1 | Layout.tsx |
| input | 23 | 3 | dock/CompactDashboard.tsx |
| dialog | 23 | 1 | dock/CompactDashboard.tsx |
| alert-dialog | 4 | 0 | Layout.tsx |
| sheet | 5 | 1 | Layout.tsx |
| popover | 1 | 0 | dock/CompactDashboard.tsx |
| dropdown-menu | 0 | 2 | Layout.tsx |
| tabs / switch / checkbox / textarea / card / tooltip | 3 / 8 / 10 / 5 / 27 / 2 | 0 / 0 / 0 / 1 / 0 / 0 | none |
| radio-group, context-menu, date-navigator, hover-card | 0 | context-menu 1 | none (hover-card is used nowhere) |

DataCube3D.tsx imports none of these.

**Blocker to decide:** the "do not edit" files stay byte-identical. But the dock (`Layout.tsx` and `dock/CompactDashboard.tsx`) renders the shared Button, Select, Input, Dialog, AlertDialog, Sheet, Popover and DropdownMenu. If I change those shared files, the dock's swipe-up panel and its dialogs will look different even though I never edit a dock file. That breaks the acceptance rule that the dock "looks exactly as before." Options:
- A. Accept the dock picking up the new shapes, the same way Inventory and Support do. This needs "unlock please" for the dock's look.
- B. Keep the dock unchanged. That means adding a `legacy` look to the shared components, and the dock files would need to opt into it. That edits locked files, so it also needs an unlock.
- C. Skip the shared Button, Select and Input changes in Phase 1.
Recommendation: A, limited to shapes and sizes.

## 2. Overrides that stay
- `<Button>` with its own h-6 to h-9: 106
- `<SelectTrigger>` with its own height: 56 (two of them are in Layout.tsx at `h-7 text-xs`)
- `<Input>` with its own height: 5
- `<DialogContent>` with its own radius or width: 167
- `<TabsList>`/`<TabsTrigger>` with their own height or `text-xs`: 26

All of these keep their own values, because their own classes override the defaults. One catch: the new `text-[15px] font-semibold` on Button, and the new radius, still apply where a call site only overrides height. So small buttons get slightly larger, bolder text unless they also set a text size.

## 3. Rows that might overflow (not fully checked)
A quick scan found few places with a fixed height or a fixed grid row: Schedule 1 file, Inventory 2, Settings 1, Time Tracking 0, Punch Clock 0. That scan can't prove nothing will clip. Default buttons, selects and inputs without their own height will grow 4px, wherever they sit. Before any code ships, I'll check each of the screens listed in the acceptance check at iPhone width (390) and report what clips.

## 4. Theme CSS
- Beach, Playa, Blaze and Spookified each keep menus and dialogs solid by matching menus, list boxes, dialogs, popover containers and `.glass-card`.
- Popovers and dropdown menus are still covered without `glass-card`.
- **Alert dialogs are the exception.** They use the "alertdialog" role, which those rules don't match. Today they stay solid only because of `glass-card`. With the planned `bg-background`, they get the theme's own background color, so they should still be solid. I'll confirm this on all 8 themes in the acceptance check. If any theme turns them see-through, the fix is one line adding "alertdialog" to those theme rules. That would change the theme rules, so it needs your OK.

## 5. No data changes
This is shape, size and shadow classes in the shared component files, plus one section-label font size. It doesn't touch the database, data reads, or any business logic.

## Waiting on
1. Pick A, B or C for the dock.
2. Approve the possible one-line theme fix for alert dialogs, if the check needs it.
