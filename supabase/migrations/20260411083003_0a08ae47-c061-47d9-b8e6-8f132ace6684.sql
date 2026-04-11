
-- Step 1: Create missing storage locations in PD that PS has
INSERT INTO inventory_locations (location_id, name, display_order)
SELECT '01a87b8b-fb29-4734-8d1b-4a47307f843c', ps_loc.name, ps_loc.display_order
FROM inventory_locations ps_loc
WHERE ps_loc.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
  AND NOT EXISTS (
    SELECT 1 FROM inventory_locations pd_loc
    WHERE pd_loc.location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c'
      AND LOWER(pd_loc.name) = LOWER(ps_loc.name)
  );

-- Step 2: Sync display_order from PS to PD for all matching storage locations
UPDATE inventory_locations pd_loc
SET display_order = ps_loc.display_order
FROM inventory_locations ps_loc
WHERE ps_loc.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
  AND pd_loc.location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c'
  AND LOWER(pd_loc.name) = LOWER(ps_loc.name);

-- Step 3: Update PD items to match PS shelf assignments by brand_item_id
UPDATE inventory_items pd_item
SET storage_location_id = pd_loc.id
FROM inventory_items ps_item
JOIN inventory_locations ps_loc ON ps_loc.id = ps_item.storage_location_id
JOIN inventory_locations pd_loc ON pd_loc.location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c' AND LOWER(pd_loc.name) = LOWER(ps_loc.name)
WHERE ps_item.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
  AND ps_item.is_active = true
  AND ps_item.brand_item_id IS NOT NULL
  AND pd_item.location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c'
  AND pd_item.brand_item_id = ps_item.brand_item_id;

-- Step 4: Also copy display_order from PS items to PD items by brand_item_id
UPDATE inventory_items pd_item
SET display_order = ps_item.display_order
FROM inventory_items ps_item
WHERE ps_item.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
  AND ps_item.is_active = true
  AND ps_item.brand_item_id IS NOT NULL
  AND pd_item.location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c'
  AND pd_item.brand_item_id = ps_item.brand_item_id
  AND ps_item.display_order IS NOT NULL;
