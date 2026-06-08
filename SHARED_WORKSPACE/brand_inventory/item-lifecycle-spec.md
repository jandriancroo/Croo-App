# Brand Inventory Item Lifecycle — Canonical Spec

_Last updated: 2026-06-08 · Author: Lovable (per Jordan's Session 1 kickoff)_
_Status: ACTIVE — governs Sessions 1-4 of the lifecycle implementation._

This document is the single source of truth for how a vendor item moves from
the wire (PFG/PA sync) all the way to being countable at a location. Every
piece of the lifecycle below is referenced by the 4-session implementation
plan at the bottom. When code or behavior drifts from this spec, fix the
code OR amend this spec — do not let them disagree silently.

---

## The flow

1. **Vendor sync** pulls `item_number`, `name`, `pack_size`, `cost` from
   order history AND vendor master list (PFG bid guide, PA catalog). Retries
   until all four are obtained or the vendor confirms unavailability.

2. **New vendor items** (not present in the brand catalog under Live, Draft,
   or Archive) enter the **Gaps queue** (`vendor_gap_alerts`).

3. **Gaps scan** runs automatically twice daily across all locations. There
   is no manual "sync" button. A manager triages each gap: ignore, promote
   to a draft brand item, or link to an existing brand item.

4. **Brand catalog states:**
   - **Live** — active in counts.
   - **Draft** — being prepared (visible in approvals, not yet countable).
   - **Archive** — excluded from ALL downstream work (seeder, backfill,
     approvals, count displays, activation trigger). Archive is terminal
     until explicitly un-archived.

5. **Per-location pack-seen ledger** records every pack structure
   encountered at each location from each vendor, with a timestamp. This is
   the source of truth for "what packs has this location actually seen?" and
   drives both the pack-enabler backfill and the per-location selection UI.

6. **Seeder** (`pack-config-seeder`) runs against Live + Draft brand
   catalog. Iterates **templates first**, pulls vendor pack data to fill in.
   Falls back to `brand_inventory_templates.pack_size` when no vendor data
   exists. Never touches Archive.

7. **Pack-enabler at the location level** uses the pack-seen ledger to
   determine which approved `brand_pack_configs` are *selectable* per
   location. A config that no vendor has ever delivered to that location is
   hidden from the selector by default.

8. **Activation trigger** blocks save attempts on active items without a
   selected default config. The trigger is only enabled after pieces 1-7
   are complete AND a pre-flight check reports zero gaps. Until then the
   trigger does not exist in production.

---

## Implementation plan (4 sessions)

| Session | Pieces | Scope |
|---|---|---|
| 1 (tonight) | 5-PFG, 6 | PFG bid cache + pack-enabler backfill (dry-run first) |
| 2 (later)   | 1       | PFG sync retry/coverage fix + monitoring |
| 3 (later)   | 2, 7    | PA vendor mappings + scheduled Gaps scan |
| 4 (later)   | 3, 4, 8 | Seeder refactor + archive enforcement + activation trigger |

Sessions 2-4 do not start until Jordan explicitly kicks them off.

---

## Session 1 — detailed scope

### Phase 1 — Cache the PFG bid list

- Reference `pa_catalog_items` (schema + RLS) for parity before drafting
  `pfg_bid_items`.
- Wire an **upsert on every existing `pfg-service` categories-action call**
  (piggyback pattern — no new round-trips required for normal operation).
- Add a new action `scrape_bid_all_locations` mirroring PA's
  `handleScrapeAllCatalogs`. Run **once** after deploy to seed.
- **Staleness model:** items not returned by the current bid don't get
  their `last_seen_at` refreshed, so they naturally fall off the 30-day
  window used by Phase 2.

### Phase 2 — Pack-enabler backfill (`pack-selection-backfill`)

- Edge function with `?dryRun=true|false`. Default is dry-run.
- **Shared parser requirement:** must use the SAME pack-string parser as
  `pack-config-seeder`. If they're currently separate, extract to a shared
  module. **No parallel parsers.**
- **Resolution hierarchy** per `(active brand_item × location)` that has no
  `location_pack_selections` row:
  1. `pfg_bid_items` where `last_seen_at >= now() - 30d`
  2. `pa_catalog_items` where `last_seen_at >= now() - 30d`
  3. `pfg_orders.items` from last 90d (most recent line wins)
  4. `pa_orders.items` from last 90d (most recent line wins)
  5. **Defer:** "no vendor presence at this location"
  6. **Defer:** "vendor presence exists, but no matching approved
     `brand_pack_config`"
- **Multi-match handling** — when a parsed vendor pack matches more than
  one approved `brand_pack_config`:
  - If one match is already someone else's default at the same location for
    the same template → use that as default.
  - Otherwise insert all matches with `is_default=false`, then pick the
    **most-recent-vendor-source** match as `is_default=true`.
  - Log every multi-match case for review.
- **Do NOT auto-run the seeder mid-Phase-2** for bucket 6. Output the list
  for Jordan's review.

### Phase 2 dry-run output

- Total pairs needing backfill.
- Per-bucket counts (1-6).
- Sample 5 from each of buckets 1-4.
- Sample 5 from bucket 5.
- **Full list** for bucket 6.
- **Full list** of multi-match cases.

### Phase 3 — Jordan runs 2 sample counts to validate

No code in this phase, just observation.

### Out of scope for Session 1

- **Activation trigger** — that's Session 4 and depends on pieces 1-4.
- Anything that touches the Sandbox location.
- Any change to `locations.lens_enabled` defaults.

---

## Checkpoints (Session 1)

| # | Gate |
|---|---|
| 1 | Lifecycle spec saved to `SHARED_WORKSPACE` ← you are here |
| 2 | Phase 1 migration text drafted (before applying) |
| 3 | Phase 1 ships and `scrape_bid_all_locations` runs once — show `pfg_bid_items` row counts per location |
| 4 | Phase 2 dry-run — show full bucket counts + samples before any inserts |

Pause for Jordan's approval at each checkpoint.
