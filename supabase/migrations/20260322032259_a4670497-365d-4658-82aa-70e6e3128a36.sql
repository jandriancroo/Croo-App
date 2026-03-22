
-- Unit normalization function: converts a recipe unit to the inventory count_unit (oz, ea, gal, ft)
-- Returns the multiplier to convert 1 recipe_unit into count_units
-- E.g., convert_recipe_unit_to_count('Gram', 'oz') => 0.035274 (1 gram = 0.035274 oz)
CREATE OR REPLACE FUNCTION public.convert_recipe_unit_to_count(
  p_recipe_unit TEXT,
  p_count_unit TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  ru TEXT;
  cu TEXT;
  oz_value NUMERIC;
  extracted_oz NUMERIC;
  extracted_lb NUMERIC;
  extracted_ml NUMERIC;
BEGIN
  ru := lower(trim(p_recipe_unit));
  cu := lower(trim(COALESCE(p_count_unit, 'oz')));

  -- If count_unit is 'ea', most recipe units map 1:1 for "Each", "CT", bottles, cans, packs
  IF cu = 'ea' THEN
    CASE
      WHEN ru IN ('each', 'ct') THEN RETURN 1.0;
      WHEN ru LIKE 'bottle%' THEN RETURN 1.0;
      WHEN ru LIKE 'can%' THEN RETURN 1.0;
      WHEN ru LIKE 'pack%' THEN RETURN 1.0;
      WHEN ru LIKE '#10 can%' THEN RETURN 1.0;
      WHEN ru LIKE 'case%' THEN
        -- Case is multiple units; need count_units_per_case (handled externally)
        RETURN NULL;
      ELSE RETURN 1.0;
    END CASE;
  END IF;

  -- For count_unit = 'oz' (most common), normalize recipe unit to oz
  IF cu = 'oz' THEN
    -- Direct oz
    IF ru IN ('oz-wt', 'oz-fl', 'oz') THEN RETURN 1.0; END IF;
    -- Grams to oz
    IF ru = 'gram' THEN RETURN 0.035274; END IF;
    -- LB to oz
    IF ru = 'lb' THEN RETURN 16.0; END IF;
    -- Gallon to oz
    IF ru = 'gallon' THEN RETURN 128.0; END IF;
    -- Half gallon
    IF ru = 'half gallon' THEN RETURN 64.0; END IF;
    -- Quart to oz
    IF ru = 'quart' THEN RETURN 32.0; END IF;
    -- Each/CT — can't convert to oz without weight info
    IF ru IN ('each', 'ct') THEN RETURN NULL; END IF;

    -- Case with LB info: "case - 25 lb" => 25 * 16 = 400 oz
    IF ru LIKE 'case%' THEN
      extracted_lb := substring(ru FROM '(\d+\.?\d*)\s*lb')::NUMERIC;
      IF extracted_lb IS NOT NULL THEN RETURN extracted_lb * 16.0; END IF;
      RETURN NULL; -- Can't determine without more info
    END IF;

    -- Pack with oz info: "pack (36.8 oz-wt)" => 36.8 oz
    IF ru LIKE 'pack%' THEN
      extracted_oz := substring(ru FROM '(\d+\.?\d*)\s*oz')::NUMERIC;
      IF extracted_oz IS NOT NULL THEN RETURN extracted_oz; END IF;
      -- Pack with LB info: "pack (3 lb)" => 48 oz
      extracted_lb := substring(ru FROM '(\d+\.?\d*)\s*lb')::NUMERIC;
      IF extracted_lb IS NOT NULL THEN RETURN extracted_lb * 16.0; END IF;
      RETURN NULL;
    END IF;

    -- Bottle with oz info: "bottle (11.15 oz-fl)" => 11.15 oz
    IF ru LIKE 'bottle%' THEN
      extracted_oz := substring(ru FROM '(\d+\.?\d*)\s*oz')::NUMERIC;
      IF extracted_oz IS NOT NULL THEN RETURN extracted_oz; END IF;
      -- Bottle with mL: "bottle (200 ml)" => 200 * 0.033814 oz
      extracted_ml := substring(ru FROM '(\d+\.?\d*)\s*ml')::NUMERIC;
      IF extracted_ml IS NOT NULL THEN RETURN extracted_ml * 0.033814; END IF;
      RETURN NULL;
    END IF;

    -- Can with oz info: "can (8.4 oz-fl)" => 8.4
    IF ru LIKE 'can%' THEN
      extracted_oz := substring(ru FROM '(\d+\.?\d*)\s*oz')::NUMERIC;
      IF extracted_oz IS NOT NULL THEN RETURN extracted_oz; END IF;
      RETURN NULL;
    END IF;

    -- #10 Can => ~106 oz
    IF ru = '#10 can' THEN RETURN 106.0; END IF;

    -- Fallback
    RETURN NULL;
  END IF;

  -- For count_unit = 'gal'
  IF cu = 'gal' THEN
    IF ru = 'gallon' THEN RETURN 1.0; END IF;
    IF ru = 'half gallon' THEN RETURN 0.5; END IF;
    IF ru = 'quart' THEN RETURN 0.25; END IF;
    IF ru IN ('oz-wt', 'oz-fl', 'oz') THEN RETURN 1.0 / 128.0; END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$$;

-- Now update resolve_recipe_ingredients to use unit conversion for costing
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
        WHEN bmi_sub.recipe_yield_qty IS NOT NULL 
             AND bmi_sub.recipe_yield_qty > 0
             AND lower(rt.uom) NOT IN ('each', 'ea')
        THEN bri2.quantity * (rt.qty / bmi_sub.recipe_yield_qty)
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
      THEN 
        -- Convert recipe qty to count_units, then cost = converted_qty * (cost_per_unit / count_units_per_case)
        CASE
          WHEN convert_recipe_unit_to_count(rt_final.uom, ii.count_unit) IS NOT NULL
          THEN ROUND(
            (rt_final.qty * convert_recipe_unit_to_count(rt_final.uom, ii.count_unit)) 
            * (ii.cost_per_unit / ii.count_units_per_case), 
            4
          )
          -- Fallback: if no conversion available, assume 1:1
          ELSE ROUND(rt_final.qty * (ii.cost_per_unit / ii.count_units_per_case), 4)
        END
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
