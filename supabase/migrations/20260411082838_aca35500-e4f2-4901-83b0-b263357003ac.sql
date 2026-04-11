
-- Build the dupe list as a CTE for clarity
WITH dupes AS (
  SELECT i.id FROM inventory_items i
  WHERE i.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
    AND i.brand_item_id IS NOT NULL AND i.is_active = false
    AND EXISTS (SELECT 1 FROM inventory_items i2 WHERE i2.location_id = i.location_id AND i2.brand_item_id = i.brand_item_id AND i2.is_active = true AND i2.id != i.id)
)
DELETE FROM inventory_recipe_ingredients WHERE ingredient_item_id IN (SELECT id FROM dupes) OR recipe_item_id IN (SELECT id FROM dupes);

WITH dupes AS (
  SELECT i.id FROM inventory_items i
  WHERE i.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
    AND i.brand_item_id IS NOT NULL AND i.is_active = false
    AND EXISTS (SELECT 1 FROM inventory_items i2 WHERE i2.location_id = i.location_id AND i2.brand_item_id = i.brand_item_id AND i2.is_active = true AND i2.id != i.id)
)
DELETE FROM inventory_count_items WHERE item_id IN (SELECT id FROM dupes);

WITH dupes AS (
  SELECT i.id FROM inventory_items i
  WHERE i.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
    AND i.brand_item_id IS NOT NULL AND i.is_active = false
    AND EXISTS (SELECT 1 FROM inventory_items i2 WHERE i2.location_id = i.location_id AND i2.brand_item_id = i.brand_item_id AND i2.is_active = true AND i2.id != i.id)
)
DELETE FROM daily_spot_count_items WHERE item_id IN (SELECT id FROM dupes);

WITH dupes AS (
  SELECT i.id FROM inventory_items i
  WHERE i.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
    AND i.brand_item_id IS NOT NULL AND i.is_active = false
    AND EXISTS (SELECT 1 FROM inventory_items i2 WHERE i2.location_id = i.location_id AND i2.brand_item_id = i.brand_item_id AND i2.is_active = true AND i2.id != i.id)
)
DELETE FROM brand_inventory_deployments WHERE inventory_item_id IN (SELECT id FROM dupes);

WITH dupes AS (
  SELECT i.id FROM inventory_items i
  WHERE i.location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
    AND i.brand_item_id IS NOT NULL AND i.is_active = false
    AND EXISTS (SELECT 1 FROM inventory_items i2 WHERE i2.location_id = i.location_id AND i2.brand_item_id = i.brand_item_id AND i2.is_active = true AND i2.id != i.id)
)
DELETE FROM inventory_items WHERE id IN (SELECT id FROM dupes);
