# Persist "Counters see" toggles on pack configs

## Problem

On the pack-config approval screen, each config has a "Counters see: Cases · Bags · Loose oz" toggle row. Approvers uncheck lanes they don't want on the count screen (e.g. Pita Chips → Cases + Bags only, no Loose oz).

Today those toggles only live in local component state (`laneOverride` in `src/pages/BrandPackConfigApprovals.tsx`). They drive the little preview underneath the form, but **nothing is written to the database**, so the count screen has no signal and shows every lane the pack shape supports. Result: approved "2-lane" config still renders 3 lanes at count time.

## Fix

Store the toggle state on `brand_pack_configs` and read it on the count screen.

### 1. Database

Add three booleans to `brand_pack_configs`:

- `show_cases`         default `true`
- `show_inner_packs`   default `true`
- `show_common_unit`   default `false`

Backfill existing rows: derive from current shape (cases always on; inner-packs on when `inner_qty > 1`; common-unit off — matches today's approval defaults).

### 2. Approval screen (`src/pages/BrandPackConfigApprovals.tsx`)

- Seed `laneOverride[r.id]` from the row's persisted flags instead of hard-coded defaults.
- On Save Draft / Approve, include the three flags in the payload.
- Preview keeps working as-is (already reads `laneOverride`).

### 3. Count screen wiring

`computeCountLanes` already accepts a `count_by` mode but it's an enum (`cases_and_units` / `cases_only` / `units_only`) and can't express "cases + packs, no loose units." Extend it minimally:

- Add optional `laneOverrides?: { showCases?: boolean; showInnerPacks?: boolean; showCommonUnit?: boolean }` on the args.
- When present, apply them after the resolver's default visibility (same pattern the approval preview already uses locally at lines 1674-1679).

Then in the count-screen data path (the lens loader used by `InventoryCountSession.tsx`), pass the three flags from the active `brand_pack_config` through to `computeCountLanes`. No behavior change for items with no override.

### 4. Revert the cosmetic label change

Roll back the "UNITS → OZS" rename in `src/utils/computeCountLanes.ts` from the previous turn. With lane hiding in place the Loose-oz lane won't render for Pita Chips / Pesto anyway, and the user didn't ask for the label change.

## Verification

- Pita Chips (SKU 788408): count screen renders **Cases | Bags** only.
- Sundried Tomato Pesto (SKU 976777): count screen renders **Cases | Jugs** only.
- Any config where approver leaves "Loose oz" checked continues to show 3 lanes.
- Approval-screen preview stays in lockstep because both paths use the same resolver + override pass.

## Out of scope

- No changes to `location_pack_selections`, seeder, or pricing logic.
- No UI redesign of the toggle row itself.
