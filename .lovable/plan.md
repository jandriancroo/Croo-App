# Review: break-violation fix (Claude's prompt)

Verdict: the diagnosis is correct and the approach is right. Three gaps to close before implementing.

## Confirmed against the code and data

- All four call sites exist as described (lines ~637, ~692, ~1145, ~1304 of `src/hooks/usePayrollData.tsx`), each with its own hardcoded `> 5`.
- `laborRules` is fetched but never used for any flag logic — only for pay periods and overtime.
- `auto-punch-out` writes `has_break_violation: shiftHours > 5`.
- Live data confirms the blast radius is wider than Texas:
  - Georgetown, Rowlett, Akers Mill, IUPUI, Hayward, Tuscaloosa, Palm Desert: no meal-break threshold set
  - Nevada stores (Sparks, South Meadows, Virginia St): 8h threshold — currently false-flagged at 5h
  - Niles: 7.5h / 20-minute break
  - Reno - Diamond Pkwy and Lite QA have no labor_rules row at all

## Gap 1 — a fifth site in the same file was missed

Line ~926 (inside the time-card issue builder) does its own `hours > 5 && shiftBreaks.length === 0` and pushes `"Missing required meal break"` into the per-employee `issues` list shown in Payroll Review. If it isn't converted, non-CA stores keep seeing the false warning in that list even after the four flag sites are fixed. It must use the same helper.

## Gap 2 — the break-punch detector is string-matched to "30 minute"

Four of the five sites find the meal break with `notes.includes('30 minute')`. Niles' rule is a 20-minute break, so its real meal breaks will never match, meaning every shift over 7.5h gets flagged even when the employee took the break. The helper should be paired with a threshold-agnostic break matcher: accept any `break_start` whose notes mention meal/unpaid or the location's own `meal_break_duration`, instead of the literal "30 minute". Site 1 already uses the looser matcher (`meal`/`unpaid`/`30 minute`) — standardize the other sites on that.

## Gap 3 — locations with a blank threshold need a decision, not silent suppression

`meal_break_hours IS NULL` means "no law" for Texas/Georgia, but Palm Desert is a California store with a blank value — treating null as "never a violation" silently turns off a real CA requirement there. Recommendation: keep the null-means-no-violation helper behavior (correct default, fixes the reported bug), and separately flag Palm Desert plus the two locations with no labor_rules row so their rules can be filled in from the state preset. No code branch, just a follow-up data fix.

## Minor notes

- Dropping the `hours < 0 → +24` guard at sites 3 and 4 is safe: both timestamps are absolute UTC, so a negative span only occurs from mis-paired punches, where suppressing the flag is preferable to inventing 24 hours. Agreed with removing it.
- `has_break_violation` stored on `time_punches` is not read anywhere in the frontend today, so no backfill is required for display correctness; the edge-function fix only stops writing wrong values going forward.
- In `auto-punch-out`, fetch labor rules for all active locations in one query before the location loop (alongside the existing locations query) rather than once per location.

## Scope

Only break-violation detection. No changes to punch clock UI/access, overtime, overnight grouping, shift pairing, `generatePayPeriods`, `aggregatePayments`, `calculateTimeDifferenceHours`, or `mark_labor_cache_stale`.

## Technical summary

1. `src/hooks/usePayrollData.tsx`: add `isBreakViolation(clockInMs, clockOutMs, breakStarts)` reading `laborRules?.meal_break_hours` (null → false), plus a shared `isMealBreakPunch(punch)` matcher; convert all five sites (637, 692, 926, 1145, 1304).
2. `supabase/functions/auto-punch-out/index.ts`: batch-load `labor_rules.meal_break_hours` per location, and write `has_break_violation` against that threshold, defaulting to `false` when unset.
3. Report the locations with missing/blank labor rules for a separate data fix.
