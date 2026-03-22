CREATE OR REPLACE FUNCTION public.calculate_theoretical_usage(
  p_location_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  vendor_item_id UUID,
  vendor_item_name TEXT,
  ingredient_name TEXT,
  total_quantity NUMERIC,
  unit_of_measure TEXT,
  total_cost NUMERIC,
  resolution_path TEXT,
  pos_mapping_name TEXT,
  units_sold NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mapping RECORD;
  v_units_sold NUMERIC;
  v_sales_row RECORD;
  v_mix_item JSONB;
  v_pos_cats TEXT[];
  v_pos_items TEXT[];
BEGIN
  -- Loop through each POS mapping that has a linked recipe
  FOR v_mapping IN
    SELECT 
      ipg.id,
      ipg.name AS mapping_name,
      ipg.bom_menu_item_id,
      ipg.pos_categories,
      ipg.pos_items
    FROM inventory_product_groups ipg
    WHERE ipg.location_id = p_location_id
      AND ipg.is_active = true
      AND ipg.bom_menu_item_id IS NOT NULL
  LOOP
    v_pos_cats := COALESCE(v_mapping.pos_categories, ARRAY[]::TEXT[]);
    v_pos_items := COALESCE(v_mapping.pos_items, ARRAY[]::TEXT[]);
    v_units_sold := 0;

    -- Sum units sold from product_mix matching this mapping's POS categories/items
    FOR v_sales_row IN
      SELECT product_mix
      FROM sales_cache
      WHERE location_id = p_location_id
        AND sale_date >= p_start_date
        AND sale_date <= p_end_date
        AND product_mix IS NOT NULL
    LOOP
      IF jsonb_typeof(v_sales_row.product_mix::jsonb) = 'array' THEN
        FOR v_mix_item IN SELECT * FROM jsonb_array_elements(v_sales_row.product_mix::jsonb)
        LOOP
          -- Match by category or by individual item name
          IF (array_length(v_pos_cats, 1) > 0 AND (v_mix_item->>'category') = ANY(v_pos_cats))
             OR (array_length(v_pos_items, 1) > 0 AND (v_mix_item->>'itemName') = ANY(v_pos_items))
          THEN
            v_units_sold := v_units_sold + COALESCE((v_mix_item->>'quantity')::NUMERIC, 0);
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    -- Skip if no sales
    IF v_units_sold = 0 THEN
      CONTINUE;
    END IF;

    -- Resolve recipe ingredients multiplied by units sold
    RETURN QUERY
    SELECT
      rri.vendor_item_id,
      rri.vendor_item_name,
      rri.ingredient_name,
      rri.total_quantity,
      rri.unit_of_measure,
      rri.total_cost,
      rri.resolution_path,
      v_mapping.mapping_name AS pos_mapping_name,
      v_units_sold AS units_sold
    FROM resolve_recipe_ingredients(v_mapping.bom_menu_item_id, v_units_sold, p_location_id) rri;
  END LOOP;
END;
$$;