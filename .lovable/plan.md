## Step 5: Hemet In-Place Cleanup

### Current State
- 143 active items already have `brand_item_id` set ✅
- 31 active items have NO brand link (mostly PA produce like Arugula, Blueberries, Romaine, etc.)
- 0 deployment records exist

### Plan

**Phase 1: Snapshot** (safety net)
- Run `takeSnapshot('12c977c7-...')` to capture all storage locations, display orders, categories, shortcuts, daily tracking configs

**Phase 2: Link the 31 orphans**
- Auto-match by `pa_item_id` or name to existing brand templates
- Any items that can't be matched → flag for manual review (you decide: create brand template or deactivate)

**Phase 3: Create deployment records**
- For all ~174 active items with brand links, insert rows into `brand_inventory_deployments`
- This is the bridge that makes vendor syncs, variance reports, and future deployments work through the mapping table

**Phase 4: Verify**
- Confirm all active items have deployment records
- Confirm recipe page still loads correctly
- Confirm no storage location / display order changes

### What WON'T change
- No items deleted
- No storage locations moved
- No display order changes
- No historical count data affected
- Count sheet looks identical before and after
