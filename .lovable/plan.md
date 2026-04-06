
## Part A: Fix PA Alternate IDs (Gap Finder false positives) ✅

### A1. One-time backfill — Seed alternate PA IDs into `brand_vendor_mappings` ✅
### A2. Future-proof — Update PA sync to auto-seed mappings ✅
### A3. Resolve stale gap alerts ✅

---

## Part B: Re-sync Preservation Logic (Phase 4 prep)

### B1. Snapshot function
- Before a location wipe, capture all active `inventory_items` for that location:
  - `vendor_number` / linked brand template ID → used as the match key
  - `storage_location_id` → which physical group (Freezer, Walk In, etc.)
  - `display_order` → position within that group
  - `category` → item category
- Store snapshot in a temp table or JSON blob

### B2. Restore-on-activation logic  
- When re-activating items from brand catalog, look up each item in the snapshot by vendor ID
- Apply the saved `storage_location_id`, `display_order`, and `category`
- Net-new items (no snapshot match) get appended at bottom with high `display_order`

### B3. Auto-activate-all on new location deployment
- In the Deploy Location Wizard, after creating the location, activate all live brand templates as local inventory items
- Manager then deactivates items they don't carry

---

## Part C: Brand Name Propagation

### C1. Auto-propagate brand name changes
- When `brand_inventory_templates.product_name` is updated, automatically push the new name to:
  - All `inventory_items` linked to that template (via `brand_inventory_deployments`)
  - All `recipe_blueprints` that reference those items (via `produces_item_id` or ingredient references)
- Implemented as a database trigger on `brand_inventory_templates` for `product_name` updates
