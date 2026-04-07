
-- Step 1: Deactivate the smaller/cheaper duplicate PA variants (keeping the larger pack)
UPDATE public.inventory_items SET is_active = false, updated_at = now()
WHERE id IN (
  'c16cc85e-c87f-4ece-b666-1a21d9039c52',  -- Red Onions (smaller $14 variant)
  'ae12a85c-49c7-4702-8abc-3dc5065f6d78',  -- Fresh Basil (lb, $8.02 variant)
  '4b772bb6-1d95-4d0b-bf08-dd038a248919',  -- Baby Spinach (2.5 lb, $6.33 variant)
  'd0d0c74b-8b55-4f67-a8c5-be76740324fa'   -- Romaine Lettuce (2 lb, $5.11 variant)
);

-- Step 2: Rename all remaining mismatched items to their brand product_name
UPDATE public.inventory_items i
SET name = bt.product_name, updated_at = now()
FROM brand_inventory_templates bt
WHERE i.brand_item_id = bt.id
  AND i.location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
  AND i.is_active = true
  AND i.storage_location_id IS NULL
  AND i.name != bt.product_name;
