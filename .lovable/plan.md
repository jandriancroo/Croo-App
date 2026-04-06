
## Part A: Fix PA Alternate IDs (Gap Finder false positives)

### A1. One-time backfill — Seed alternate PA IDs into `brand_vendor_mappings`
- Query all `pa_catalog_items` that match existing live brand templates by name
- For each alternate PA ID (not the primary `pa_item_id` on the template), insert into `brand_vendor_mappings` with `vendor = 'pa'`
- This eliminates the 29 false-positive outliers immediately

### A2. Future-proof — Update PA sync to auto-seed mappings
- In the `produce-alliance-service` edge function, after upserting to `pa_catalog_items`:
  - Match each catalog item against `brand_inventory_templates` by name
  - If matched and the PA ID isn't the primary `pa_item_id`, auto-insert into `brand_vendor_mappings`
- This ensures new alternate IDs from future syncs are captured automatically

### A3. Resolve stale gap alerts
- After seeding, mark the 28 false-positive `vendor_gap_alerts` as resolved

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
