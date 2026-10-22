# Quick Tasks card: one home for every quick task (Step 0 report)

Report only. Nothing is built until you say "go".

## 1. Findings 3 and 4

**Finding 3: confirmed.** `AssignedTemporaryTasks.tsx:379-382`. If there are no tasks, events or catering orders, the component returns nothing before it ever reaches the `afterEventsContent` lines (255 and 311).
- On a quiet day (no assigned tasks or events at the store), **AM Safe Count, PM Safe Count, Drawer Count and Daily Spot Check never show for anyone**, even inside their time windows.
- The moment any one task or event exists, they come back. That's the "sometimes missing" the owner sees. It hits every role that has cash or spot-check access. Team members aren't affected, because they never see these anyway.

**Finding 4: corrected. There's no duplicate. Catering orders are actually missing from the card on Dash.**
- The Dash calls the card without `includeCateringOrders` (`QuickTasksSection.tsx`). That means the card's catering lookup is switched off (`AssignedTemporaryTasks.tsx:193-212`, `enabled: ... && includeCateringOrders`).
- On Dash, catering only shows as the separate `CateringOrdersAlert` card, which covers today's and tomorrow's pending orders.
- Catering rows inside the card only appear on the Today tab (`Option6TodayContent.tsx:91`), which turns catering on.

**Finding 1 (small correction).** The card is drawn in two places. The Dash uses the "sectioned" version (lines ~232-277): an orange header with QuickTaskRows. The other, older layout of separate cards is what the Today tab uses. Write-up "Sign" tasks show as ordinary rows in the Dash card. The "Sign" button label only exists in the older layout (line 631).

**Finding 2: confirmed.** Cash and spot-check show as loose teal cards outside the orange card.

**Finding 5: confirmed, plus one possible bug.** `PinMigrationTask.tsx:52` hides the PIN card when `pin_pending` is set. You described this row as "PIN pending", but in the code the card is the request to set a PIN, and it disappears once a pending PIN exists. Before I build, please tell me which state should show the "Set your new PIN" row. My assumption is that it shows exactly when the card shows today.

## 2. Other things on the Dash that ask a person to act

- **Training assignments** (`TrainingAssignmentsSection`, Dashboard.tsx:570): its own section under Tasks. **Keep it separate.** It's a list of courses with progress, not a quick one-tap task.
- **Opus background sync**: switched off by a feature flag and shows nothing on screen. **Leave it out.**
- **Quick Nudge**: the manager swipe-up and header button. It's a tool, not a task. **Leave it out.**
- **System alerts / announcements popup**, **billing banner**: popups and banners, not tasks. **Leave them out.**
- **Tomorrow's catering orders** (only in CateringOrdersAlert): this is a heads-up, not something due today. I'd show them as a muted "Tomorrow" row inside the card, not counted as due. Or we drop them. Your choice.

## 3. Proposed shape

New file `components/dashboard/useQuickTaskSources.ts`. Each existing card's lookup and rules move into a small helper that returns plain row data instead of drawing a card:

- `usePinTaskRow()`: PIN status. Returns null or `{ dueInDays }`.
- `useI9TaskRows()`: pending I-9 requests. Returns one row each.
- `useReadAndSignRows()`: pending documents. Returns one row each, opening the same full-screen ReadAndSignView.
- `useCashTaskRows(hours, tz)`: the same categories, entries, windows, `canAccess*` and submitted-today checks as CashHandlingTasks. Returns AM / PM / Drawer rows, each opening the same logbook page.
- `useSpotCheckRow(hours, tz)`: the same rules as DailySpotCheckTask. Opens the same drawer.

Composition happens in `AssignedTemporaryTasks`'s sectioned branch. A new optional `extraRows` prop is passed from `QuickTasksSection`. The dialogs and drawers each card opens today stay mounted from `QuickTasksSection`, driven by which row is selected.

- `afterEventsContent` is removed from the Dash. It stays available for the Today tab, which doesn't use it today.
- The early return is fixed. In sectioned mode, "nothing to show" means no tasks, no events, no catering **and no extra rows**. So a cash-only day shows the card.
- Catering on Dash: turn on `includeCateringOrders` and remove `<CateringOrdersAlert />` from the Dash. The file stays, unused.

Row order: red (PIN, I-9), amber (Read & Sign, write-up Sign), events by time, normal tasks, catering, teal (cash, spot check). I'd put catering before teal, since pickup times are customer deadlines.

**Lookups:** these are the same lookups with the same names and the same refresh timing: 30s for tasks, cash and spot check, and none for PIN, I-9 and Read & Sign. Moving them into the card adds none. Catering on Dash would switch from the alert's lookup (60s) to the card's lookup (30s). That's one swap, not an extra. If you'd rather keep 60s, I'd reuse the alert's lookup instead.

## 4. Counts

- Every new row counts toward M in "N of M done".
- Cash and spot check disappear once submitted today (that's how they work now), so they never add to N. A done one just drops out of the card.
- Read & Sign, I-9 and PIN also disappear when finished.
- Overdue: a cash or spot-check row is overdue in the last 30 minutes of its window. The PIN row is overdue at "Due today" or later. Read & Sign is overdue if its due date has passed. Please confirm these, because this is new behavior.
- The header count and the collapsed summary come from the same total, so they update together.

## 5. Background tint on the new rows

- `QuickTaskRow` gets one optional prop, `wash?: 'teal' | 'amber' | 'red'`, which only adds a background class. Its spacing, circles, text and height stay exactly as they are.
- Classes: `bg-primary/8` (teal), `bg-warning/10` (amber), `bg-destructive/8` (red). These use existing color tokens and work in light and dark.
- If a `warning` token doesn't exist, I'd add it to the global stylesheet for both themes instead of hard-coding a color.

## 6. Use outside the Dash

- `Option6TodayContent.tsx:91` (Today tab) uses the older layout without `sectioned` and without extra rows. **Nothing changes there.**
- The cash, spot-check, PIN, I-9 and Read & Sign card files are only used by `QuickTasksSection`. They stay in place but are no longer shown on the Dash.

## 7. Riskiest parts and tests

1. **Moving the cash and spot-check window rules.** Mitigation: copy the rules into a pure function and test it with fixed times: AM at open ±2h, PM and Drawer at close to close+2h, after midnight, a role without access, and an entry already submitted today.
2. **Tapping a row has to open the same thing as today** (logbook page, spot-check drawer, full-screen read-and-sign, PIN dialog, I-9 upload). Mitigation: keep each card's existing dialog component and only change what opens it.
3. **Showing on a quiet day without duplicates.** Test the card logic with only cash due, and with PIN, I-9 and Read & Sign all at once.

Browser checks: quiet day with only cash due, a role without cash access, all three account-level rows at once, the card collapsed and expanded, phone and tablet width, light and dark.

## 8. Locked files and business logic

- None of the touched files are locked: QuickTasksSection, AssignedTemporaryTasks, QuickTaskRow, the new hook file, and possibly the global stylesheet for one color.
- No cubes, dock, toast/drawer or support-ticket code is changed. Logbook, cash, inventory/spot-count, punch, labor and nudge logic stay as they are: the window and access rules are moved word for word, not rewritten.
- No migrations, no data changes.

**Questions before "go":** which PIN state should show the row (section 1), tomorrow's catering in or out (section 2), and the overdue rules (section 4).
