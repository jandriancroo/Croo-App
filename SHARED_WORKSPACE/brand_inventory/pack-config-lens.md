<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# Pack Config Lens — Project State

Living state doc for the pack-config approval workstream. Pairs with:
- `.lovable/pack-config-approval-spec.md` (canonical Phase 1 spec)
- `.lovable/pack-config-seeder-spec.md` (Step 4 seeder)
- `.lovable/snapshot-immutability-spec.md` (count snapshot freeze)

## Current state — [2026-05-25 · Lovable]

### DONE

- **Lens valuation** — pack-config-derived `cost_per_common_unit` flows through the valuation lens for items with an approved config selected.
- **Tiers** — proposed / approved / archived lifecycle live on `brand_pack_configs`. No hard-delete; supersede via status change.
- **Preview** — brand-inventory UI surfaces proposed vs approved configs side-by-side before commit.
- **Gate** — submitted counts (`status='completed'`) freeze pack qty + cost into `_at_count` columns and ignore live config changes forever. Backed by Step 2 backfill (3,497 historical rows snapshotted May 22).
- **Unit cleanup** — `common_unit` vocabulary normalized (`lb`, `oz`, `ga`, `kg`, `ea`); pack-string parser handles `"4 / 1 GA"`, `"1/4 LB"`, `"3 CT"` formats.

### IN-PROGRESS

- **Config approval grind** — **~190 items remaining** without an approved `brand_pack_configs` row. Working through them brand-by-brand using the seeder's `proposed` rows + traceable-source evidence.

### Key rules (load-bearing — do not violate)

1. **`common_unit` = what you COUNT, not what the vendor measures.**
   Vendor sells `4 / 1 GA` → operator counts gallons → `common_unit = 'ga'`, `count_units_per_case = 4`. Never store the vendor's pack unit as the count unit.
2. **Snapshot immutability.** Once a count is `status='completed'`, its `pack_quantity_at_count` + `cost_at_count` are frozen. No pack-config edit, no cost edit, no brand-template change rewrites it. Enforced in `getEffectivePackQty.ts` + `countItemValue.ts` (snapshot-wins, fail-closed).
3. **No delete except junction rows.** `brand_pack_configs` rows are archived (`status='archived'`), never deleted. `location_pack_selections` rows can be replaced (PK is `(location_id, brand_template_id)`) because they're a junction, not history.

## History

- [2026-05-25 · Lovable] Initial seed of this lens doc as part of shared-workspace bootstrap.
