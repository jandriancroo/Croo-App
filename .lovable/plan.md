
# Break Coverage Assignments

Add an optional per-location layer for scheduling **breaks within shifts** and assigning a **coverer** for each break. Built for daycare (teachers + breakers) but works for any location that wants pre-arranged break coverage. Gated behind a master toggle so locations that don't use it see zero UI changes.

## 1. Master toggle — Settings → Location Settings

New compact row in `LocationSettingsSection.tsx` (same pattern as the Time-Off Cutoff card):

- **Break Coverage Assignments** toggle (off by default)
- Help text: "Lets you schedule break times within shifts and assign a coverer for each break. Used by daycares and any location with pre-arranged break coverage."

When off: nothing related to breaks/coverage appears anywhere in the schedule UI, shift form, template form, or day timeline. When on: break + coverage controls unlock.

## 2. Data model

Add to `location_settings`:
- `break_coverage_enabled boolean default false`

Add to `shift_templates` and `scheduled_shifts`:
- `breaks jsonb default '[]'::jsonb` — array of `{ id, start_time, end_time, covered_by_user_id? }`

Templates only ever store `start_time`/`end_time` per break (no coverer — that's day-of). Scheduled shifts can store an optional `covered_by_user_id` per break.

**Standalone coverages** (coverer has no shift that day): same `breaks` jsonb mechanism on a lightweight `scheduled_shifts` row with `is_coverage_only = true` (new boolean column, default false). This row carries no `start_time`/`end_time` of its own — it exists purely to attach a coverage entry pointing at another shift's break. Labor math and existing schedule rendering ignore `is_coverage_only` rows entirely.

No new tables. No changes to `time_punches`, `labor_cache`, `payroll`, or any cache logic.

## 3. Labor math — deferred (safe)

`calculateShiftHours` in `src/utils/shiftUtils.ts` keeps its current behavior (auto-deduct 30 min if shift > 5h). The new `breaks` array is purely metadata for now. When you're ready to switch to explicit-break math later, it's a one-function change with no backfill needed — break data will already be on every shift that uses the feature.

## 4. Shift form (mobile + desktop) — when enabled

Below the existing time fields, add:

- **+ Add Break** button → reveals a row with start/end time inputs + optional **Covered By** employee dropdown + delete
- Tap **+ Add Break** again to add more breaks (multiple supported)
- Coverer dropdown is grouped by role (same pattern as the existing employee selector group-by-role work)

Same UI is added to the template form on `ShiftTemplates.tsx` minus the coverer dropdown (templates only pre-bake times).

## 5. Day timeline rendering

**Covered person's bar:** amber striped overlay segment across the break window, with a small coffee icon + coverer's initials inside (e.g. `☕ DR`). Tap → popover: "Break 12:00–1:00 · Covered by Diego R."

**Coverer's row:** lighter shaded block labeled `Covering Alle · 12–1`. If they have no shift that day, the row only appears because of the coverage block (no empty rows otherwise).

**Conflict guard:** soft warning (not a block) if the chosen coverer's own break overlaps the same window or they're already covering someone else at that time.

**Day view header:** small "Show coverage" toggle (default on) to hide the overlay layer when a manager wants raw shifts only.

## 6. Printable / PDF day timeline — Option C (visual + roster)

New "Print / PDF" button in the day timeline header. Generates a single PDF:

- **Page 1 — Visual timeline (landscape):** horizontal hour grid, one row per employee, shift bars to scale, break overlays + coverage shading matching the on-screen view. Station grouping respected if Stations is enabled.
- **Page 2 — Roster + coverage list (portrait):** vertical list grouped by employee — name, role, shift times, then indented break lines like `12:00–1:00 · Covered by Diego R.` Followed by a per-person "Covering" section listing any coverage assignments they're providing.

Implementation mirrors the existing `src/utils/exportSchedulePrint.ts` pattern: a dedicated print stylesheet + a `window.print()` path for paper, plus a "Download PDF" action that uses the same PDF stack already in the project. New file `src/utils/exportDayTimelinePrint.ts`.

## 7. Out of scope (easy follow-ups)

- Honoring explicit breaks in labor math (deferred per your call)
- Recurring weekly coverage patterns
- Coverage notifications/push
- Per-break notes

---

### Technical notes

- Migration: add `break_coverage_enabled` to `location_settings`; add `breaks jsonb` + `is_coverage_only boolean` to `shift_templates` and `scheduled_shifts`. No RLS changes — existing shift policies cover the new columns.
- New types: `ShiftBreak` in shared schedule types.
- New helper `getBreakOverlaysForDay(shifts)` → returns `{ coveredOverlays, coveringBlocks }` for the timeline renderer.
- All new UI gated on `location_settings.break_coverage_enabled` — locked-feature areas (3D cubes, dock, inventory) untouched.
- Timezone: break times stored as `HH:mm` strings anchored to the shift's date in location timezone (same pattern as shift times). No new `Date` objects.
- Printable view: dedicated route-less component rendered into a hidden iframe for `window.print()`, with `@page { size: landscape; }` for page 1 and `@page { size: portrait; }` for page 2 via a page-break wrapper.
