# Refactor: Centralize Leg Fetching & Valuation

Stop duplicating leg queries + valuation across readers. One source of truth.

## New file: `src/hooks/useLegsValuation.ts`

Exports both a hook (for components) and a pure utility (for non-React contexts like Inventory.tsx summary query functions and future COGS/Variance reducers).

### Types

```ts
export type LegRow = {
  id: string;
  count_item_id: string;
  pack_config_id: string;
  entered_cases: number | null;
  entered_units: number | null;
  entered_inner_packs: number | null;
  quantity_common: number | null;
  cost_at_count: number | null;
  pack_quantity_at_count: number | null;
  inner_pack_quantity_at_count: number | null;
};

export type LegsByCountItemId = Record<string, LegRow[]>;
export type LegsConfigsMap = Record<string, { id: string; label: string; count_units_per_case: number; inner_qty: number | null }>;

export type LegsValuationBundle = {
  legsByCountItemId: LegsByCountItemId;
  legsConfigsMap: LegsConfigsMap;
  legsEnabled: boolean;
  isLoading: boolean;
  getItemValueWithLegs: (
    countItem: { id: string; ... },   // the inventory_count_items row (with snapshot fields)
    item: InventoryItem,              // the inventory_items row (live data)
    conversion: ConversionContext,    // existing arg shape from calculateCountItemValue
    opts?: { forceLiveData?: boolean }
  ) => number;
};
```

### Hook

```ts
useLegsValuation(countId: string | undefined, locationId: string | undefined): LegsValuationBundle
```

- Runs 3 React Query queries (keyed on `["legs-valuation", countId]`):
  1. `locations.legs_enabled` for `locationId` → `legsEnabled`
  2. `inventory_count_item_legs` joined to `inventory_count_items` filtered by `count_id` → grouped into `legsByCountItemId`
  3. `brand_pack_configs` (approved only) referenced by those legs → `legsConfigsMap`
- Gated: if `legsEnabled === false`, queries 2 & 3 are skipped and maps are empty.
- All fields (snapshots included) selected once, identical to current Session/Review/Export selects.

### Utility (non-hook)

```ts
buildLegsValuation(args: {
  legsRows: LegRow[];
  configs: LegsConfigsMap;
  legsEnabled: boolean;
}): Pick<LegsValuationBundle, "legsByCountItemId" | "legsConfigsMap" | "legsEnabled" | "getItemValueWithLegs">
```

Same shape, but takes already-fetched data. Used by `Inventory.tsx` summary query function and any future server-side reducer. The hook is a thin wrapper that calls `buildLegsValuation` after fetching.

### `getItemValueWithLegs` rules (single implementation)

1. Look up `legs = legsByCountItemId[countItem.id] ?? []`.
2. If `legsEnabled && legs.length >= 2` → pass `legs` (with configs resolved) to `calculateCountItemValue`. Per-leg uses snapshot `cost_at_count` / `pack_quantity_at_count` when present, else live commonUnitCost (Issue-1 formula).
3. Else (single-config) → fall through to canonical `calculateCountItemValue(countItem, item, conversion, undefined, opts)`. Parent snapshot wins on frozen counts (already correct).
4. `opts.forceLiveData` is forwarded to `calculateCountItemValue` unchanged.

## Consumer refactors

| File | What gets removed | What it calls |
|---|---|---|
| `InventoryCountView.tsx` | inline `legsByCountItemId` + `legsConfigsMap` queries, inline leg-aware valuation in the reducer | `useLegsValuation(countId, locationId)` → use `getItemValueWithLegs` everywhere it currently calls `calculateCountItemValue` |
| `CountExportDialog.tsx` | the 3 leg/config/legs_enabled queries from Step 4, inline `legs.length >= 2 ? legs : undefined` checks | same hook; row builder calls `getItemValueWithLegs` for parent; per-leg detail rows still iterate `legsByCountItemId[ci.id]` directly (display data, not valuation logic) |
| `InventoryCountSession.tsx` | the leg snapshot hydration in the existing query + the inline leg branch in `getItemCost` | replace `getItemCost`'s leg branch with `getItemValueWithLegs(countItem, item, conv, { forceLiveData: !isFrozen })`. Stepper inputs untouched. |
| `Inventory.tsx` (summary) | inline leg fetch inside the period summary query fn | inside the query fn: fetch legs + configs + legs_enabled once, then call `buildLegsValuation(...)` and use `getItemValueWithLegs` in the reducer. No hook (not a component context). |

Future consumers (COGS, Variance, Reconciliation): just call the hook or utility — zero new query code.

## Non-goals

- No change to `calculateCountItemValue` itself.
- No change to stepper inputs, autosave payloads, or save-path stamping (Bug B stays as-is).
- No change to CSV column shape from Step 4.
- No DB / migration changes.

## Verification after apply

1. Open the current Spinach count (`/inventory/.../count/240fe79f...`) — Review total, Session footer, and Export parent total must match $53.61 exactly.
2. Open a single-config count — totals unchanged from before refactor.
3. Open an `in_progress` count — Session stepper still reads live data (no snapshot freeze for non-completed).
4. Inventory period summary card total matches Review total for the same count.

## Apply order

1. Create `src/hooks/useLegsValuation.ts` (hook + utility + types).
2. Refactor `InventoryCountView.tsx`.
3. Refactor `CountExportDialog.tsx`.
4. Refactor `InventoryCountSession.tsx` (`getItemCost` only — leg hydration in the existing fetch can be dropped since the hook owns it).
5. Refactor `Inventory.tsx` summary query fn to use `buildLegsValuation`.
6. Smoke-check the 4 verification points above.

Approve and I'll apply in that order, showing the hook file in full first, then per-consumer diffs.