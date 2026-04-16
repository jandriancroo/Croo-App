DO $$
DECLARE
  pd_location_id UUID := '01a87b8b-fb29-4734-8d1b-4a47307f843c';
BEGIN
  -- Child records that reference inventory_items by item_id
  DELETE FROM daily_spot_count_items WHERE item_id IN (SELECT id FROM inventory_items WHERE location_id = pd_location_id);
  DELETE FROM vendor_invoice_items WHERE matched_item_id IN (SELECT id FROM inventory_items WHERE location_id = pd_location_id);

  -- Spot count + inventory count parents
  DELETE FROM daily_spot_count_items WHERE spot_count_id IN (SELECT id FROM daily_spot_counts WHERE location_id = pd_location_id);
  DELETE FROM daily_spot_counts WHERE location_id = pd_location_id;
  DELETE FROM inventory_counts WHERE location_id = pd_location_id;

  -- Vendor invoices + items
  DELETE FROM vendor_invoice_items WHERE invoice_id IN (SELECT id FROM vendor_invoices WHERE location_id = pd_location_id);
  DELETE FROM vendor_invoices WHERE location_id = pd_location_id;

  -- Orders
  DELETE FROM pa_orders WHERE location_id = pd_location_id;
  DELETE FROM pfg_orders WHERE location_id = pd_location_id;

  -- Logs / rates / recipes / groups
  DELETE FROM inventory_sync_logs WHERE location_id = pd_location_id;
  DELETE FROM inventory_usage_rates WHERE location_id = pd_location_id;
  DELETE FROM inventory_waste_logs WHERE location_id = pd_location_id;
  DELETE FROM recipe_blueprints WHERE location_id = pd_location_id;
  DELETE FROM inventory_product_groups WHERE location_id = pd_location_id;

  -- Deployments (links brand templates to local items)
  DELETE FROM brand_inventory_deployments WHERE location_id = pd_location_id;

  -- Local inventory items
  DELETE FROM inventory_items WHERE location_id = pd_location_id;

  -- Shelf / storage locations
  DELETE FROM inventory_locations WHERE location_id = pd_location_id;
END $$;