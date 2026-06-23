# Seeder label cosmetic — override path produces parsed-pack label

**Status:** open, not blocking
**Filed:** 2026-06-23
**Component:** `supabase/functions/pack-config-seeder/index.ts`

## Symptom

When `brand_vendor_mappings.pack_override_*` rewrites the pack structure
(e.g. Plastic Wrap SKU 926587 / 899594 overridden to `1/1 ea` from
`12/1 RL`), the proposal still ships with the label derived from the raw
parsed pack — not the final overridden pack. Approvers see e.g. `12/1 ea`
on a config whose actual `outer_qty/inner_qty/common_unit` are `1/1 ea`.

## Root cause

In the per-source resolution loop (around line 546), the label is taken
from `r.label` which was set at parse time via `formatPackLabel(parsed)`.
Override application happens later (lines 552–558) but the label is never
re-derived from `final`.

## Fix sketch

Replace:

```ts
label: r.label ?? null,
```

with:

```ts
label: formatPackLabel({
  outer_qty: final.outer_qty,
  inner_qty: final.inner_qty,
  common_unit: final.common_unit,
}),
```

Frontend reads `count_units_per_case` / `outer_qty` / `inner_qty` for the
actual math, so this is purely a display bug in the approval UI. Stored
configs are correct.

## Why deferred

Approval flow is currently single-pass per template and humans verify
numerics, not the label string. Worth fixing before the next bulk seed
so approvers aren't second-guessing the displayed pack descriptor.
