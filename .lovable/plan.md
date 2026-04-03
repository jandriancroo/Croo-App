
# CrooHQ Inventory Architecture v2
## Brand-Centric Mapping, Scaling Intelligence & Legacy Migration

---

## 1. PHILOSOPHY & PRINCIPLES

### Core Principle: Brand Catalog as Single Source of Truth
- The **Brand Catalog** (`brand_inventory_templates`) is the identity standard for every ingredient, prep item, and recipe across all locations.
- **Recipes reference brand items, not vendor items.** Costing flows through the local item linked to the brand template.
- **Vendor reality varies** — the system accepts this and builds flexible linking on top of a central standard.

### Costing Philosophy
- Brand-level costing is for **recipe validation and profit structuring** — not accounting-level per-location precision.
- **Hemet (California)** serves as the high-cost baseline ("North Star") for brand recipe validation. If a recipe has good margins at CA pricing, it works everywhere.
- Per-location actual costing happens at the location level through vendor sync + order data.

### Matching Philosophy
- **Strict vendor number matching** at location level — reduces errors, no fuzzy guessing.
- **Fuzzy matching only happens once** at brand level during initial catalog setup (controlled environment).
- **Unmatched items default to disabled** — prevents bad data from entering the system silently.

---

## 2. DATA ARCHITECTURE

### 2.1 Current Tables (No Changes Needed)
| Table | Role |
|---|---|
| `brand_inventory_templates` | Master catalog — identity, names, categories, recipe flag, pack overrides |
| `inventory_items` | Location-level items — linked to brand templates, carry local vendor pricing |
| `recipe_blueprints` | Brand-level recipes — ingredients reference brand template items |
| `recipe_blueprint_ingredients` | Recipe ingredient lines — qty, unit, sub-recipe refs |
| `pfg_orders` | PFG vendor order history — used for costing lookups |
| `pa_orders` / `pa_order_items` | Produce Alliance order data |

### 2.2 New Table: `brand_vendor_mappings`
**Purpose:** Store multiple vendor IDs per brand template (one-to-many), supporting regional SKU variations.

```
brand_vendor_mappings
├── id (uuid, PK)
├── brand_template_id (FK → brand_inventory_templates.id)
├── vendor (text) — 'pfg', 'produce_alliance', etc.
├── vendor_item_id (text) — the vendor's SKU/item number
├── territory (text, nullable) — 'california', 'texas', 'alabama', etc.
├── source_location_id (FK → locations.id, nullable) — which location first mapped this
├── created_at (timestamptz)
└── UNIQUE(brand_template_id, vendor, vendor_item_id)
```

**Why a separate table vs. JSON column:**
- Clean querying for auto-match lookups (`WHERE vendor_item_id = ?`)
- Easy to add/remove individual mappings without JSON manipulation
- Audit trail (which location contributed which mapping)
- No risk of JSON corruption or format drift
- Scales cleanly to 50+ locations without column bloat

**Migration from current columns:**
- Existing `item_number` (PFG) and `pa_item_id` (PA) on `brand_inventory_templates` get copied into this table as seed records
- Those columns can remain as "primary" references or be deprecated over time

### 2.3 Already Implemented: Pack Size Override (Nested Structure)
Columns already on `brand_inventory_templates`:
- `pack_override_outer_type` (Box, Case, Bag, etc.)
- `pack_override_outer_qty` (how many inner packs per outer)
- `pack_override_inner_type` (Sleeve, Pack, Roll — optional)
- `pack_override_inner_qty` (pieces per inner pack — optional)
- **Effective override** = `outer_qty × (inner_qty ?? 1)`
- Supports 1-layer (Bag of 50) or 2-layer (Case → 10 Sleeves → 100 pieces)
- Counters can count at **any layer** — system converts
- Flows into recipe costing engine for accurate per-unit costs

---

## 3. DATA FLOW ARCHITECTURE

### 3.1 The Full Chain
```
QU POS Sale → POS Mapping → Recipe Blueprint → Brand Ingredient → Local Vendor Item → Brand Template
```

### 3.2 How Each Layer Works

**POS → Recipe (Depletion):**
- QU POS items are mapped to Menu Item (MI) blueprints in the Recipe Catalog
- When items sell, depletion calculates ingredient usage based on product mix
- Already fully implemented

**Recipe → Brand Ingredient:**
- Recipe blueprints reference brand catalog items (or sub-recipes)
- Sub-recipes (BASE, CORE) produce intermediate items (dough, sauces)
- Recipe math uses pack overrides for accurate unit costs
- Already fully implemented

**Brand Ingredient → Local Item:**
- Each location's `inventory_items` are linked to brand templates via `brand_template_id`
- Local items carry the actual vendor pricing from syncs
- Depletion consumes from the local item's quantity

**Local Item → Vendor:**
- PFG sync + PA sync refresh order data and pricing
- Item numbers on local items must match vendor SKUs for price linkage
- Pack size overrides on brand templates deploy down to local items

### 3.3 Auto-Mapping Flow (New Location Onboarding)
```
1. Location runs initial vendor sync (PFG + PA)
   → Downloads bid list / catalog items with vendor SKUs

2. System checks each incoming vendor item against brand_vendor_mappings
   → Match by (vendor, vendor_item_id) — STRICT, no fuzzy

3. Matched items:
   → Create/link local inventory_item with brand_template_id
   → Inherit brand name, category, storage location, pack overrides
   → Item is ENABLED and ready for counting

4. Unmatched items:
   → Created as local-only items
   → DISABLED by default (flagged for review)
   → Appear in "Unassigned" / "Flagged Items" list

5. Admin reviews flagged items:
   → Maps to existing brand template (adds new vendor ID to brand_vendor_mappings)
   → OR marks as location-only item (rare exceptions like local beer)
   → OR ignores (item stays disabled)

6. New vendor IDs mapped by this location feed back into brand_vendor_mappings
   → Future locations in same territory auto-match without flagging
   → System gets smarter with every new site
```

### 3.4 Scaling Intelligence Model
```
Location 1 (Hemet, CA):     Maps PFG #447552 → BBQ Sauce template
Location 2 (Palm Springs):  Same PFG warehouse → auto-matches #447552 ✓
Location 3 (Tuscaloosa, AL): Different PFG warehouse → gets #891234 for same product
                              → Flagged → Admin maps → brand now knows BOTH IDs
Location 4 (Niles, OH):     Same region as Tuscaloosa → auto-matches #891234 ✓
```

**Result:** The `brand_vendor_mappings` table for BBQ Sauce would have:
| vendor | vendor_item_id | territory | source_location |
|---|---|---|---|
| pfg | 447552 | california | Hemet |
| pfg | 891234 | alabama | Tuscaloosa |

---

## 4. LEGACY MIGRATION PLAN

### 4.1 Phase 1: Brand Catalog Cleanup (Manual, ~2-3 hours)
**Goal:** Establish the brand catalog as a clean, mapped master list.

1. **Audit brand templates** — ensure every active template has a clean name and correct category
2. **Map PFG item numbers** — using Hemet's current item data as the reference
3. **Map PA item IDs** — using Hemet's Produce Alliance data
4. **Seed `brand_vendor_mappings`** — copy existing `item_number` and `pa_item_id` from templates into the new table
5. **Set pack overrides** — configure nested pack structure for items with weird vendor packaging (brownies, cups, lids, etc.)
6. **Validate recipes** — ensure all blueprint ingredients resolve to brand items or sub-recipes

### 4.2 Phase 2: Hemet In-Place Cleanup (Automated + Light Manual)
**Goal:** Align Hemet's local items with the brand catalog without losing historical count data.

**Why NOT blank slate:** Hemet has valuable historical count data. Since Hemet IS the source for the brand catalog, most items already have vendor IDs. An in-place cleanup preserves this data.

1. **Disable items without vendor numbers** — any local item missing both `item_number` and `pa_item_id` gets `is_active = false`
   - Same strict-match validation that new locations use
   - These items had no vendor linkage anyway — they were counting ghosts
2. **Re-sync PFG + PA** — fresh vendor sync pulls current SKUs and pricing
   - Incoming items match to brand templates via `brand_vendor_mappings`
   - Items get proper `brand_template_id` linkage
   - Pricing data refreshes
3. **Review remaining unmatched** — small handful of items that didn't auto-match
   - Map manually or disable
4. **Historical data preserved** — all items that had vendor numbers keep their count history intact

### 4.3 Phase 3: Palm Springs In-Place Cleanup
**Same process as Hemet.** Palm Springs shares the same PFG/PA warehouses, so the brand vendor mappings from Phase 1 + Hemet's additions should auto-match nearly everything.

### 4.4 Phase 4: New Territory Locations (Tuscaloosa, Rowlett, etc.)
**These follow the standard onboarding flow:**
1. Initial vendor sync
2. Auto-match against `brand_vendor_mappings` (now containing CA + any prior regional IDs)
3. Flagged items get manually mapped → new vendor IDs feed back into the system
4. Deploy brand standard (categories, storage locations, pack overrides)

---

## 5. IMPLEMENTATION PHASES (CODE CHANGES)

### Phase A: Database Schema
1. Create `brand_vendor_mappings` table with RLS policies
2. Seed table from existing `item_number` and `pa_item_id` columns on `brand_inventory_templates`
3. No breaking changes — existing columns remain functional during transition

### Phase B: Auto-Mapping Engine
1. Update vendor sync (PFG + PA) to check `brand_vendor_mappings` for matches instead of (or in addition to) `item_number`/`pa_item_id` on templates
2. When a match is found: set `brand_template_id` on the local item, inherit brand standards
3. When no match: create item as disabled, flag for review
4. When a location manually maps an exception: insert new row into `brand_vendor_mappings` with `source_location_id`

### Phase C: Location Management UI
1. **Flagged Items screen** — shows disabled/unmatched items with a fast search bar to map to brand templates
2. **Enable/Disable toggle** — same pattern already built, just wired to the new matching logic
3. **Manual mapping search** — cached vendor data for instant lookup

### Phase D: Pack Override Deployment
1. Wire `pack_override_*` columns into the brand → location deployment flow
2. When deploying a brand template to a location, push the calculated effective override to `inventory_items.pack_quantity_override`
3. Location can still override independently for alternate vendors

### Phase E: Hemet/Palm Springs Migration Script
1. Automated script to disable items without vendor numbers
2. Re-trigger vendor syncs
3. Report on unmatched items for manual review

---

## 6. WHAT'S ALREADY BUILT vs. WHAT'S NEW

### ✅ Already Built & Working
- Brand Catalog (`brand_inventory_templates`) with full CRUD
- Recipe Blueprints with sub-recipe support (BASE, CORE, MI categories)
- POS mapping (MI → QU items)
- Depletion engine (POS sales → recipe → ingredient consumption)
- Pack size override columns (nested structure, brand + location level)
- Pack override wired into recipe costing engine
- `parsePackSizeToOz` fallback for can/weight conversions
- Vendor sync (PFG headless + PA REST API)
- Gap Finder (vendor catalog diffing)
- Draft promotion flow (invoice → brand catalog)
- Brand deployment wizard
- Location onboarding gate

### 🆕 Needs to Be Built
- `brand_vendor_mappings` table
- Seed script (existing IDs → mapping table)
- Auto-match engine update (sync checks mapping table)
- "Feed-back" logic (location exception → new mapping row)
- Flagged items review screen (location level)
- Pack override deployment wire-up (brand → location push)
- Hemet/PS migration script

### 🔧 Needs Refinement
- Vendor sync should write `cost_per_unit` / `blended_price` on item records (currently only refreshes order data)
- Brand Catalog UI for managing vendor mappings per template (view/add/remove vendor IDs)

---

## 7. COMPARISON TO MATURE SYSTEMS

### How This Compares to Enterprise Restaurant Inventory
| Feature | Enterprise (MarketMan, BlueCart, R365) | CrooHQ v2 |
|---|---|---|
| Central catalog | ✅ Brand/corporate-managed | ✅ `brand_inventory_templates` |
| Multi-vendor SKU mapping | ✅ Vendor items table | ✅ `brand_vendor_mappings` |
| Location-level pricing | ✅ Per-location vendor costs | ✅ Local `inventory_items` with vendor sync |
| Recipe management | ✅ Centralized recipes | ✅ Blueprints with sub-recipes |
| POS integration | ✅ Direct POS feeds | ✅ QU Beyond V4 API |
| Auto-depletion | ✅ Real-time or batch | ✅ Batch via product mix |
| Pack size handling | ⚠️ Usually manual per-item | ✅ Nested override (brand → location) |
| New location onboarding | ⚠️ Usually fully manual | ✅ Auto-match + flag exceptions |
| Learning/scaling mapping | ❌ Rarely | ✅ Vendor IDs accumulate across locations |
| Variance reporting | ✅ Theoretical vs actual | 🔧 In progress |

### What CrooHQ Does Better Than Most
1. **Scaling Intelligence** — vendor ID library grows with every location, reducing manual work over time
2. **Nested pack overrides** — most systems require manual per-item setup at every location
3. **Brand → Location deployment** — standards push down automatically
4. **Strict-match + disable-by-default** — prevents bad data from entering silently

### What Enterprise Systems Do Better (Future Considerations)
1. **Real-time depletion** — CrooHQ uses batch; real-time is a future upgrade
2. **Purchase order generation** — automated reorder based on par levels
3. **Multi-unit conversions** — full unit conversion tables (CrooHQ uses targeted conversions)
4. **Waste tracking** — dedicated waste logging with reason codes
5. **Invoice OCR → auto-reconciliation** — CrooHQ has AI invoice upload but reconciliation is manual

---

## 8. RISK MITIGATION

| Risk | Mitigation |
|---|---|
| Initial mapping takes too long | Start with Hemet only (~160 items). PA + PFG IDs are already in the system. |
| Vendor changes SKU without notice | Items appear as "flagged" at location — admin maps → system learns |
| Two locations use same vendor ID for different products | `brand_vendor_mappings` UNIQUE constraint prevents this. If it happens, territory column disambiguates. |
| Historical count data lost during migration | In-place cleanup preserves all items with vendor numbers. Only vendor-less items (already untrackable) get disabled. |
| Pack override deployed incorrectly | Location can always override independently. Brand override is a default, not a lock. |
| Sync writes bad prices | Costing engine already handles missing/partial data gracefully with "partial" warnings |

---

## 9. SUCCESS CRITERIA

After implementation, the system should:
1. ✅ Auto-match 90%+ of items when onboarding a new location in an existing territory
2. ✅ Preserve all historical count data for Hemet and Palm Springs
3. ✅ Show accurate recipe costs using pack overrides (brownies = $0.55, not $17.53)
4. ✅ Flag unmatched items clearly without silently enabling bad data
5. ✅ Allow one-time brand mapping to serve all current and future locations
6. ✅ Get stronger at auto-mapping with every new location added
