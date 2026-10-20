# Phase 2A — STEP 0 gate report (no code written)

## 1. What each call site is

| Call site | What it is | Current behavior | Verdict |
|---|---|---|---|
| pages/Tasks.tsx:100 | Single-choice (By Category / Heatmap) | Two hand-made buttons, 12px, Layers + Grid3x3 icons, sets viewMode | Convert (neutral, full width) |
| pages/Tasks.tsx:127 | Single-choice (Week / Month), only shows in Heatmap | Two buttons, sets heatmapRange | Convert (neutral) |
| tasks/EditTabContent.tsx:182 | Single-choice (Quick Tasks / Checklists) via UnderlineGroup, in a `pl-4` wrapper | Sets activeTab | Convert (neutral, icons kept, drop `pl-4`) |
| LocationPickerDialog.tsx:569 | Single-choice org tabs (only when several orgs and no brand header) | Sets activeTab and clears search; already uses primary fill; scrolls sideways | Convert, but recommend `primary` (it is page-tab style, not a view switch) — needs your call |
| schedule/MobileScheduleView.tsx:848 | Week day strip: picks one date, two lines (Mon / 20), plus a "today" highlight | Sets selectedDate | Something else — skip (a date strip, not a text selector; the "today" tint would be lost) |
| schedule/MobileScheduleView.tsx:1069 | Same week day strip, second view | Same | Skip |
| tasks/CreateTemporaryTaskDialog.tsx:571 (Alarm) and :743 (Team) | Multi-select day picker | 7 Buttons, flex-1, 12px, Mon..Sun (values 1..6,0) | Convert |
| tasks/EditTemporaryTaskDialog.tsx:463 (Team) and :486 (Alarm) | Multi-select day picker | Same as above | Convert |
| tasks/EditTemplateDialog.tsx:344 | Multi-select day picker | 7 Buttons w-10 h-8, `flex-wrap` | Convert |
| pages/ShiftTemplates.tsx:458 | Multi-select day picker, but as a 2-column checkbox list with full day names (Sunday-first index 0..6) | Checkboxes call toggleDay(index) | Convertible; recommend yes, using short labels |
| Reporting.tsx:1020, 1156, 1228; BrandDashboard.tsx:395; SeenByDialog.tsx:122,126 | Real Tabs with size overrides | — | Remove overrides as planned |

All four task dialogs use the identical toggle rule: remove if present, otherwise add and sort ascending (Sun=0 sorts first). ShiftTemplates has its own toggleDay.

Recommendation for the day row: DayToggleRow calls back with the tapped day (`onToggle(day)`), and each caller keeps passing its existing toggle function. That guarantees saved values and order are byte-identical, instead of re-implementing the sort inside the new component. Your spec says `onChange(number[])` — please pick one.

## 2. Reporting date-range tabs (line 1197)
That row is `hidden md:flex` — it never shows on iPhone, only iPad and up. Seven labels at 15px fit easily at 768px+. So no scroll row is needed; I would just remove the overrides. (I'll still add `shrink-0` safety only if you want it.)

## 3. Day rows at 390 width
- Create / Edit Quick Task dialogs: dialog is 366px wide, 24px padding each side → 318px inside. 7 × 40 = 280, leaving about 6px per gap. Fits.
- Edit Template dialog: capped at 100vw − 2rem = 358px → 310px inside → about 5px per gap. Fits (and `flex-wrap` goes away).
- ShiftTemplates dialog: default dialog, 318px inside. Fits.
- Labels are 3 letters (Mon..Sun) at 13px, about 26px wide — fit inside a 40px circle.

## 4. Locked files and logic
- No locked file is in the change list (no cube files, nothing in components/inventory, BrandInventory, dock, toasts/drawer, WeeklySummaryEntry, or support tickets).
- No handler, state, value or saved-data change. Only markup and classes; every onClick/onValueChange keeps calling the same setter.

## Decisions needed before build
1. LocationPickerDialog: `primary` (recommended) or `neutral`?
2. MobileScheduleView week strips: skip (recommended)?
3. ShiftTemplates: convert to DayToggleRow (recommended)?
4. DayToggleRow API: `onToggle(day)` using each caller's existing toggle (recommended) or `onChange(number[])`?
5. Reporting 7 tabs: just remove overrides (desktop/iPad only), no scroll row?

Stopping here until sign-off.
