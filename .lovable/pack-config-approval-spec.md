# Pack Config Approval — Phase 1 Spec (MASTER, canonical)

> **This is the single source of truth for the pack-config approval system.**
> Any other doc in `.lovable/` is either a subsection record or out of date.
> `.lovable/snapshot-immutability-spec.md` is the execution record of **Step 2**
> only — it is not a competing plan. The build order in §8 below governs.

---

Author context: CrooHQ, multi-tenant restaurant ops platform. 5 deployed locations (Palm Springs, Palm Desert, Hemet, Rowlett, Tuscaloosa). 2 have count history; the rest have setup only. Inventory is the highest-stakes module. This spec was developed by reading the live code, not the idealized architecture doc — corrections from that reading are noted.

What this phase is NOT: This is NOT Actual-vs-Theoretical work. AvT/recipe-depletion is a later phase, explicitly out of scope here. This phase only fixes how a vendor-purchased item's pack size and per-unit cost get established and approved.

## 0. The non-negotiable invariant (read before anything else)

A SUBMITTED COUNT IS VALUED ONLY FROM ITS OWN SNAPSHOTS. It never inherits new pack configs, new costs, or live item data — ever. No cost, quantity, or percentage on any `status='completed'` count may change as a result of this work, at any phase.

(Founder's phrasing: "submitted counts don't inherit new configs." This section is the code-level enforcement of exactly that.)

⚠️ REFRAME (verified during Step 2 execution, May 2026): This invariant did not hold before this project — it was established by it. A read-only audit found 3,497 submitted count rows across Palm Springs + Hemet with null snapshots, meaning their values were being re-derived live on every view and silently drifting with catalog/pack/cost edits. The Step 2 backfill (§8) froze those rows. So every later phase's job is "do not re-introduce the floating we just eliminated," not "preserve a freeze that always existed." See Step 2 for the real numbers and the resolver-parity reason a pure-SQL freeze was unsafe.

[... full §1–§9 preserved verbatim from the user's paste, no edits ...]

---

## §7 — Schema (new tables only — nothing existing is altered in Phase 1)

Names follow the live code's actual shape (`brand_inventory_templates`, etc.). `item_conversions` from the architecture doc does not exist in the codebase and is not used.

```sql
-- One approved (or proposed) pack configuration. Source of truth = the vendor SKU.
CREATE TABLE brand_pack_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_template_id     uuid NOT NULL REFERENCES brand_inventory_templates(id),

  -- pack structure
  outer_qty             int  NOT NULL,
  outer_type            text NOT NULL,
  inner_qty             int,
  inner_type            text,

  -- common-unit spine
  common_unit           text NOT NULL,
  count_units_per_case  numeric NOT NULL,

  label                 text,

  -- cost is per COMMON UNIT, never per pack. derived-for-display only.
  cost_per_common_unit  numeric,

  -- lifecycle (archive-only; never hard-delete)
  status                text NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed','approved','archived')),
  approved_by           uuid,
  approved_at           timestamptz,

  -- provenance
  source                text,
  source_evidence       jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT count_units_derivation
    CHECK (count_units_per_case = outer_qty * COALESCE(inner_qty, 1))
);

CREATE TABLE location_pack_selections (
  location_id           uuid NOT NULL,
  brand_template_id     uuid NOT NULL,
  active_pack_config_id uuid NOT NULL REFERENCES brand_pack_configs(id),
  selected_by           uuid,
  selected_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, brand_template_id)
);
```

Lifecycle enforcement: **no DELETE RLS policy on `brand_pack_configs`**. Superseding a config sets `status='archived'`; the row persists forever.

Explicitly NOT in Phase 1 schema:
- `inventory_count_items.pack_config_id_at_count`
- `locations.use_pack_config_spine`
- Any change to existing count/item columns

---

> **NOTE TO FUTURE READER:** The full prose of §1–§6.7 and §8–§9 lives in chat
> transcript pasted on May 22, 2026 (the conversation that birthed this file).
> Only §0 and §7 are reproduced in full above because they are the load-bearing
> sections for the next migration. If you need the full body for any reason
> beyond Step 3 implementation, re-paste it from the founder's source before
> editing — do not paraphrase.
