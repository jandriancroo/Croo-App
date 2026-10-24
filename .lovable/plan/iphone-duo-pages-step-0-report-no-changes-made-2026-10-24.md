# iPhone Duo pages — Step 0 report (no changes made)

Nothing has been edited. This report covers what would change and where. When you say "go", I'll build the Dash tab first.

## 1. Files and call sites

| Item | File / location |
|---|---|
| Duo mode hook (new) | `src/hooks/useDuo.ts` (new) + one CSS block in `src/index.css` scoped to `html.duo` |
| Folded / open header | `src/components/Layout.tsx` — phone `<header>` at L1139 (fixed bar), tablet/desktop `<header className="sticky …">` at L932 |
| Web dock (already hidden by shell) | `Layout.tsx` L1529 `nav.mobile-dock-container` — Duo CSS hides it in-app, so the injected CSS is no longer needed |
| Dash sentence | `src/pages/Dashboard.tsx` L127 (`dashSentence`), passed to `PageTitle` as `subtitle` at L640; `src/components/PageTitle.tsx` |
| Dash + Schedule split | `src/pages/Dashboard.tsx`, `src/components/schedule/MobileScheduleView.tsx` |
| Manager dash | `src/components/dock/CompactDashboard.tsx` (close chevron L597), mounted from `Layout.tsx` L1574 |
| Profile menu | `Layout.tsx` L1231 `SheetContent side="bottom"` (Update button + Settings/Sign out row) |
| Shared popups | `src/components/ui/dialog.tsx` L39, `ui/sheet.tsx` L32–41, `ui/drawer.tsx` L34 |
| Edit Punch | `src/components/schedule/EditPunchDialog.tsx` (has `onOpenAutoFocus` at L459) |
| Quick Punch | `src/components/schedule/QuickPunchDialog.tsx`, `src/components/timeclock/QuickPunchDialog.tsx` |
| Quick Task | `src/components/tasks/CreateTemporaryTaskDialog.tsx` |
| New Shift sheet | `src/components/schedule/MobileAddScheduleSheet.tsx` (L531, L961) |
| Announcement | `src/components/feed/PostComposer.tsx` (`autoFocus` L161) |

## 2. Locked files

- **Unlocked for the Duo items only:** `components/dock/CompactDashboard.tsx` (hide the chevron on the Duo, limit to the left panel), `EditPunchDialog.tsx`, both `QuickPunchDialog.tsx`.
- **Locked, not touched:** the cubes, inventory, toasts and version-update files, and the support ticket files (`SupportChatPanel` and the Settings inbox). On the Duo, Support gets its layout from the page's outside frame only. Everything inside the panel stays the same.
- **Watch out:** the drawer slides away for toasts (part of the locked dock/toast animation). Changes to `ui/drawer.tsx` will be limited to a Duo-only width and height limit. The slide and toast behavior stay as they are.
- `ios/` is never edited.

## 3. Autofocus audit (popups that put the cursor in a text field on open)

Fields that grab focus inside a popup or sheet:
- **Feed/Announcement:** `PostComposer` L161
- **Inline comments:** `InlineComments` L162
- **Location picker:** search field after 100ms (`LocationPickerDialog` L313)
- **Theo bubble:** input after 200ms (`AiAssistantBubble` L240)
- **New Shift:** custom start time after 80ms (`MobileAddScheduleSheet` L384, after a template pick)
- **Save as template:** `SaveAsTemplateDialog` L131
- **Toast link field:** `ToastLinkField` L107
- **Positions settings:** `PositionManagementInline` L195/222, `PositionManagementCompact` L235/264
- **Review items:** `ManageReviewItemsDialog` L95/434
- **Delete count:** `DeleteCountDialog` L76
- **Inventory:** `PanSizesSection` L367, `ProductGroupsManager` L407, `BrandPanMatrixSheet` L57
- **Vendor gaps / POS link:** `VendorGapFinder` L991/1296, `PosLinkIndicator` L183
- **Checklists:** checklist editor title / item name / add input (`ChecklistSettingsPanel` L95, `ChecklistItemInspector`, `ChecklistEditor` L226–248), bulk upload L174, mention input L271, temperature input (`ChecklistRunView`)
- **Pages:** `ScheduleSettings` L548, `DynamicChecklistCalendar` L610, `SystemAlertsAdmin` L46, `TemperatureValidation` L311, `BrandPackConfigApprovals`, `DemoGate`, `PinMigrationOverlay`

Already blocked: `MobileShiftDialog`, `MobileAddScheduleSheet` (dialogs), `InventoryItemsManager`, `DynamicChecklistCalendar` popover, schedule popovers.

Separately, Radix dialogs and sheets put focus on the first field they find by default. That is the main reason the Announcement box jumps.

**Fix (Duo only):** the shared dialog, sheet and drawer stop that default when `html.duo` is set. A small `useDuoSafeAutoFocus()` helper turns off the `autoFocus` / timed `.focus()` calls listed above, but only inside popups. Inline page fields and chat inputs stay as they are.

## 4. Duo mode contract (for the Swift side)

On `<html>`:
- class `duo` — always while running on a Duo
- class `duo-folded` **or** `duo-open` — exactly one, updated when the phone folds or unfolds
- `--duo-col-left`, `--duo-col-right` — width of Apple's column (`0px` when none)
- `--duo-panel-split` (new) — x-position of the fold/hinge in px when open, so the two panels line up with the real screens
- `--duo-corner-radius` (new) — the screen's corner radius, so the folded bar's top-right corner can follow it
- `--duo-camera-top`, `--duo-camera-height` (new, optional) — so the camera can sit inside the teal with a margin. If you skip these, I'll use `env(safe-area-inset-top)`.

How pages read them:
- `useDuo()` returns `{ isDuo, isOpen, isFolded, colLeft, colRight }`. It watches the class with a MutationObserver, so a fold switches live without a reload.
- Styling uses `html.duo …` selectors and `var(--duo-…)` values, so most changes are CSS only.

## 5. Dash split plan

- On `html.duo-open` on the Dash tab, `Layout` shows a two-column frame: the left column at phone width (up to `--duo-panel-split`) and the right column for the rest, stopping at the column.
- **Left panel:** the phone Dash, as today. **Right panel:** `MobileScheduleView`, with its own scroll.
- Both use the existing phone components, forced to phone layout through the existing `useIsMobile` override. Each panel scrolls on its own.
- **Manager dash:** `CompactDashboard` is mounted inside the left panel's frame (`position: absolute`, not full screen) only when on a Duo. Otherwise the mount at L1574 stays the same. The close chevron (L597) is hidden by `html.duo` CSS. The existing open/close signal from the native arrow stays the same.
- `dashSentence` moves into the open header. `PageTitle` gets `subtitle={null}` only when on an open Duo.

## 6. Other tabs (plan only; Dash first)

| Tab | Approach | Effort |
|---|---|---|
| Chat | Two-column frame: the DM list on the left, the feed on the right. A conversation opens over the right panel. Reuses the phone components. | Medium |
| Tasks | Managers: History on the left, Edit on the right. Crew: History full width. The checklist editor spans both panels as is. | Medium |
| Logs | New-log form on the left, the feed with search on the right. Both are existing pieces. | Small–medium |
| Schedule | Force the existing desktop grid, and hide the top nav on the Duo. No new layout. | Small |
| Users / Settings | The list squeezes to the left width, the editor on the right. These pages already have list/detail parts. | Medium |
| Support | Outer two-column frame only, and ticket files untouched. If that isn't enough, it needs your "unlock please". | Small (frame only) |
| Everything else | The desktop view with the Duo header. No per-page work. | Small |
| Dialogs in panels | Duo frame panels act as the place popups open. Each panel sets a CSS variable for where its center is, and the shared dialog centers there. | Medium (shared, done once) |

## 7. Header details

- **Folded:** the existing phone bar gets Duo-only styling. It runs to the right edge, its top-right radius is `var(--duo-corner-radius)`, and its buttons are padded by `var(--duo-col-right) + 12px`. The avatar is hidden.
- **Open:** one bar that stops at the column: logo → location / Ovation → Ask Theo → `dashSentence`. The tab icons, Time dropdown, Nudge and avatar are hidden on the Duo only.

## 8. Profile menu

On the Duo only, Update becomes a round icon-only button, the same size as Sign out, and the profile card takes the rest of the row. Off the Duo, the layout stays as it is today.

## 9. Shared popup fix (Duo only)

- **Dialog:** centered in `left: var(--duo-col-left)` → `right: var(--duo-col-right)`, `max-height` follows the visible screen and shrinks when the keyboard is up, and the body scrolls while the footer stays fixed so Save is always reachable.
- **Sheet / drawer:** stop at the column, and their height is limited the same way.
- **The five named popups:**
  - Edit Punch: wider and padded inside the space left of the column.
  - Quick Punch and New Shift: their height is limited, so they scroll instead of cutting off.
  - Quick Task: wrapping instead of truncating.
  - Announcement: no focus on open.

## 10. Additive confirmation

- Every change is behind `html.duo` CSS selectors or `useDuo().isDuo`.
- With the class missing (normal iPhone, iPad, desktop, PWA), the rendered markup and styles match today's. New hooks return false and add nothing to the page.
- No data, RPC, schema, function or query changes.
- I'll check this before shipping. I'll capture phone, iPad and desktop screens before and after with Duo off and compare them, then fake the Duo classes in the preview to check each Duo layout.

## Questions for you

1. Can the shell set `--duo-panel-split` and `--duo-corner-radius`? Without them, I'll guess 50% and 40px.
2. Does the native arrow open the manager dash with the same signal as today's swipe-up? I'll keep that signal either way.
