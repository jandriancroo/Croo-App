-- Step 1: Delete deployment records pointing at the 178 inactive items at Rowlett
DELETE FROM brand_inventory_deployments
WHERE location_id = '6eda7b4b-dab1-435c-89b3-38a7a5ac0a3e'
  AND inventory_item_id IN (
    SELECT id FROM inventory_items
    WHERE location_id = '6eda7b4b-dab1-435c-89b3-38a7a5ac0a3e'
      AND is_active = false
  );

-- Step 2: Delete the 178 inactive inventory items at Rowlett
DELETE FROM inventory_items
WHERE location_id = '6eda7b4b-dab1-435c-89b3-38a7a5ac0a3e'
  AND is_active = false;