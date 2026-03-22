
-- Fix: only divide by yield when ingredient unit is weight/volume (not "Each")
CREATE OR REPLACE FUNCTION public.resolve_recipe_ingredients(
  p_menu_item_id UUID,
  p_quantity_multiplier NUMERIC DEFAULT 1.0,
  p_location_id UUID DEFAULT NULL
)
RETURNS TABLE (
  vendor_item_id UUID,
  vendor_item_name TEXT,
  ingredient_name TEXT,
  total_quantity NUMERIC,
  unit_of_measure TEXT,
  cost_per_unit NUMERIC,
  total_cost NUMERIC,
  resolution_path TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE recipe_tree AS (
    SELECT
      bri.ingredient_id,
      bi.r365_name AS ing_name,
      bi.is_prep_item,
      bi.inventory_item_id,
      bri.quantity * p_quantity_multiplier AS qty,
      bri.unit_of_measure AS uom,
      bi.location_id AS loc_id,
      1 AS depth,
      bmi.r365_name || ' > ' || bi.r365_name AS path
    FROM bom_recipe_ingredients bri
    JOIN bom_ingredients bi ON bi.id = bri.ingredient_id
    JOIN bom_menu_items bmi ON bmi.id = bri.menu_item_id
    WHERE bri.menu_item_id = p_menu_item_id

    UNION ALL

    SELECT
      bri2.ingredient_id,
      bi2.r365_name AS ing_name,
      bi2.is_prep_item,
      bi2.inventory_item_id,
      CASE
        -- If parent references sub-recipe by weight/volume AND sub-recipe has yield:
        -- parent_qty is a portion of the batch, so ratio = parent_qty / yield
        WHEN bmi_sub.recipe_yield_qty IS NOT NULL 
             AND bmi_sub.recipe_yield_qty > 0
             AND lower(rt.uom) NOT IN ('each', 'ea')
        THEN bri2.quantity * (rt.qty / bmi_sub.recipe_yield_qty)
        
        -- If parent references by "Each" (make N runs of this recipe):
        -- just multiply ingredient qty by how many runs
        ELSE bri2.quantity * rt.qty
      END AS qty,
      bri2.unit_of_measure AS uom,
      bi2.location_id AS loc_id,
      rt.depth + 1 AS depth,
      rt.path || ' > ' || bi2.r365_name AS path
    FROM recipe_tree rt
    JOIN bom_menu_items bmi_sub 
      ON bmi_sub.r365_name = rt.ing_name
      AND (bmi_sub.location_id = rt.loc_id OR rt.loc_id IS NULL)
    JOIN bom_recipe_ingredients bri2 ON bri2.menu_item_id = bmi_sub.id
    JOIN bom_ingredients bi2 ON bi2.id = bri2.ingredient_id
    WHERE rt.inventory_item_id IS NULL
      AND rt.depth < 5
  )
  SELECT
    ii.id AS vendor_item_id,
    ii.name AS vendor_item_name,
    rt_final.ing_name AS ingredient_name,
    rt_final.qty AS total_quantity,
    rt_final.uom AS unit_of_measure,
    COALESCE(ii.cost_per_unit, 0) AS cost_per_unit,
    CASE 
      WHEN ii.cost_per_unit IS NOT NULL AND ii.count_units_per_case IS NOT NULL AND ii.count_units_per_case > 0
      THEN ROUND(rt_final.qty * (ii.cost_per_unit / ii.count_units_per_case), 4)
      ELSE 0
    END AS total_cost,
    rt_final.path AS resolution_path
  FROM recipe_tree rt_final
  LEFT JOIN inventory_items ii ON ii.id = rt_final.inventory_item_id
  WHERE rt_final.inventory_item_id IS NOT NULL
     OR NOT EXISTS (
       SELECT 1 FROM bom_menu_items bmi_check
       WHERE bmi_check.r365_name = rt_final.ing_name
         AND (bmi_check.location_id = rt_final.loc_id OR rt_final.loc_id IS NULL)
     );
END;
$$;
