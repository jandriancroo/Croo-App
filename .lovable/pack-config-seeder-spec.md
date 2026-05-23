# Pack Config Seeder — Spec

Single source of truth for the committed `pack-config-seeder` edge function.
Mirrors the shape of `.lovable/snapshot-immutability-spec.md` Step 2.

---

## §0 — Framing

Before May 23, 2026: the 233 rows in `brand_pack_configs` were created by
ad-hoc SQL that was never committed to the repo. There was no traceability,
no dry-run capability, and no way to distinguish reproducible rows from
hand-written or orphaned ones. The Step 4 seeder creates that traceability
for the first time.

---

## Step 4 — One-shot pack-config seed  *(shipped May 23, 2026)*

Edge function: `supabase/functions/pack-config-seeder/index.ts`.
Audit table: `public.pack_config_seed_log`.

Reads traceable vendor sources (PFG orders, PA catalog), parses pack strings
using the same regex the live PFG service uses, matches SKUs to brand templates
via `brand_vendor_mappings`, and produces `brand_pack_configs` rows with
`status='proposed'`.

### Sources of truth

| Source | Table | Key field | Pack field | Price field |
|---|---|---|---|---|
| PFG orders | `pfg_orders` | `items->itemNumber` | `items->packSize` | `items->price` |
| PA catalog | `pa_catalog_items` | `pa_item_id` | `pack_size` | `unit_price` |

### Pack-string parser

Handles three formats seen in the wild:
- `"4 / 1 GA"` — PFG order format (spaces around slash)
- `"1/4 LB"` — PA catalog format (tight slash)
- `"3 CT"` — single-pack, no slash (outer=1 implied)

Units normalize to `brand_pack_configs` vocabulary:
- `lb`, `lbs` → `inner_type=lb`, `common_unit=lb`
- `oz`, `ozs` → `inner_type=oz`, `common_unit=oz`
- `ga`, `gal`, `gallon` → `inner_type=ga`, `common_unit=ga`
- `kg`, `kgs` → `inner_type=kg`, `common_unit=kg`
- `ct`, `ea`, `each`, `cn`, `count` → `inner_type=ea`, `common_unit=ea`
- everything else → passthrough raw

### Dry-run classification

For every existing `brand_pack_configs` row:
- **matched** — a traceable source exists and produces byte-identical values
- **diff** — a traceable source exists but one or more values differ (cost, outer_type, count_units_per_case)
- **orphan** — no traceable source found (invoice-only, hand-written, etc.)
- **new** — traceable source exists but no matching proposed row

### Idempotency

Deduplication key: `(brand_template_id, outer_qty, inner_qty, inner_type, common_unit, source)`.
The function will not create duplicate proposed rows for the same structure.

### Audit

Every classification and every insert is logged to `pack_config_seed_log` with:
- `run_id` — ties all rows from a single invocation together
- `dry_run` — true for preview runs, false for actual writes
- `status` — `matched`, `diff`, `orphan`, `created`, `skipped`

---

## §7 — Schema

```sql
CREATE TABLE public.pack_config_seed_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_template_id     uuid REFERENCES public.brand_inventory_templates(id),
  vendor                text,
  vendor_item_id        text,
  pack_string           text,
  outer_qty             int,
  inner_qty             int,
  inner_type            text,
  common_unit           text,
  count_units_per_case  numeric,
  cost_per_common_unit  numeric,
  existing_config_id    uuid REFERENCES public.brand_pack_configs(id),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('matched','diff','orphan','created','skipped')),
  dry_run               boolean NOT NULL DEFAULT false,
  run_id                text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
```

RLS: enabled. SELECT policy uses `has_location_access` through brand → org → location chain.
No INSERT/UPDATE/DELETE policies — edge function writes via service_role.

---

## Sequencing

1. ⏳ Step 4 — one-shot pack-config seed (just shipped)
2. ⏸ Step 5 — (reserved) nightly re-seed or vendor-gap reconciliation

---

## Memory updates owed

- None yet. When Step 5 lands, update `mem://architecture/inventory/cost-resolution-hierarchy` to reference the seeder as the canonical origin for pack config proposals.
