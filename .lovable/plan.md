
# CrooHQ Inventory Architecture v2 — Final Implementation Plan

## WHAT WE'RE BUILDING

A `brand_vendor_mappings` table that stores multiple vendor SKUs per brand template, with optional per-SKU pack size overrides. This powers auto-matching for new locations, scaling intelligence across territories, and accurate regional costing.

---

## DATABASE CHANGE

### New Table: `brand_vendor_mappings`
| Column | Type | Purpose |
|---|---|---|
| id | uuid PK | Row ID |
| brand_template_id | FK → brand_inventory_templates | Which brand item |
| vendor | text | 'pfg', 'produce_alliance', etc. |
| vendor_item_id | text | The vendor's SKU number |
| territory | text (nullable) | 'california', 'texas', etc. |
| source_location_id | FK → locations (nullable) | Which location first mapped this |
| pack_override_outer_type | text (nullable) | Box, Case, Bag — SKU-specific |
| pack_override_outer_qty | integer (nullable) | Units per outer container — SKU-specific |
| pack_override_inner_type | text (nullable) | Sleeve, Pack — SKU-specific |
| pack_override_inner_qty | integer (nullable) | Pieces per inner — SKU-specific |
| created_at | timestamptz | Auto |
| **UNIQUE** | (brand_template_id, vendor, vendor_item_id) | Prevent duplicates |

**Pack override resolution order:**
1. SKU-level override (from `brand_vendor_mappings`) — highest priority
2. Brand template default (from `brand_inventory_templates`) — fallback
3. Raw vendor pack size — last resort

---

## STEP-BY-STEP EXECUTION ORDER

### Step 1: Create `brand_vendor_mappings` Table
- Migration with RLS policies (brand members can read/write)
- No code changes yet — just the table

### Step 2: Seed the Table from Existing Data
- SQL script copies `item_number` (PFG) and `pa_item_id` (PA) from `brand_inventory_templates` into `brand_vendor_mappings`
- Territory = 'california', source_location = Hemet
- Existing columns on templates remain untouched (no breaking changes)

### Step 3: Brand Catalog Cleanup (Manual, ~2-3 hours)
- **You do this manually in the app:**
  - Audit brand templates — clean names, correct categories
  - Verify PFG item numbers are mapped (using Hemet's data)
  - Verify PA item IDs are mapped
  - Set pack overrides on items with weird packaging (brownies, cups, lids)
  - Validate recipe blueprints resolve to brand items or sub-recipes

### Step 4: Update Vendor Sync to Use Mapping Table
- PFG sync checks `brand_vendor_mappings` for matches (strict vendor_item_id match)
- PA sync does the same
- When match found → set `brand_template_id` on local item, inherit brand standards
- When no match → create item as disabled, flag for review
- Sync also writes `last_vendor_price` / `last_price_date` to inventory_items (already happening)

### Step 5: Hemet In-Place Cleanup
- **Why not blank slate:** Hemet has valuable historical count data
- **Process:**
  1. Disable all local items that lack BOTH `item_number` and `pa_item_id` (these were counting ghosts)
  2. Re-trigger PFG + PA sync — incoming items auto-match via `brand_vendor_mappings`
  3. Matched items get proper `brand_template_id` linkage + fresh pricing
  4. Small handful of unmatched items → review manually via Flagged Items screen
  5. Historical count data preserved for all items that had vendor numbers

### Step 6: Palm Springs In-Place Cleanup
- Same process as Hemet
- Same PFG/PA warehouses → should auto-match nearly everything
- Any new SKUs discovered get added to `brand_vendor_mappings`

### Step 7: Build Flagged Items Review Screen
- Location-level screen showing disabled/unmatched items
- Fast search to map to brand templates
- When admin maps an item → new row inserted into `brand_vendor_mappings` with source_location_id
- Prompt: "Is the packaging the same as brand standard?" → set SKU-level pack override if different

### Step 8: Feed-Back Logic (Scaling Intelligence)
- When a location manually maps an exception → new vendor ID feeds into `brand_vendor_mappings`
- Future locations in same territory auto-match without flagging
- System gets smarter with every new site

### Step 9: New Territory Locations (Tuscaloosa, Rowlett, etc.)
- Standard onboarding flow:
  1. Initial vendor sync
  2. Auto-match against `brand_vendor_mappings` (now containing CA + any regional IDs)
  3. Flagged items reviewed → new IDs feed back
  4. Deploy brand standard (categories, storage, pack overrides)

### Step 10: Vendor Lifecycle Monitoring (Enhancement)
- Discontinued items → suggest replacements from vendor's similar-item data
- Missing from sync → flag "Possibly Removed" for review
- Unavailable/stockout → ignore (no false alarms)

---

## WHAT'S ALREADY BUILT vs. WHAT THIS ADDS

### ✅ Already Working
- Brand Catalog with full CRUD + pack override columns
- Recipe Blueprints with sub-recipe support
- POS mapping + Depletion engine
- Vendor sync (PFG headless + PA REST)
- Gap Finder, Draft promotion, Brand deployment wizard
- Location onboarding gate

### 🆕 This Plan Adds
- `brand_vendor_mappings` table (with per-SKU pack overrides)
- Seed script from existing template IDs
- Auto-match engine update (sync checks mapping table)
- Feed-back logic (location exception → new mapping row)
- Flagged items review screen
- Hemet + Palm Springs in-place migration
- Vendor lifecycle detection (discontinued/missing)
