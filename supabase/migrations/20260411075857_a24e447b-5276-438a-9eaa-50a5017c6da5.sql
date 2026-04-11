
CREATE OR REPLACE FUNCTION public.auto_deploy_brand_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brand_id uuid;
  v_loc RECORD;
  v_base_url text := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/deploy-location-inventory';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg';
BEGIN
  v_brand_id := NEW.brand_id;

  -- Case 1: Template just went live (deploy item to all locations)
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'live' AND NEW.status = 'live')
     OR (TG_OP = 'INSERT' AND NEW.status = 'live') THEN
    
    FOR v_loc IN
      SELECT l.id AS location_id
      FROM locations l
      JOIN organizations o ON o.id = l.organization_id
      WHERE o.brand_id = v_brand_id
        AND l.is_active = true
    LOOP
      PERFORM net.http_post(
        url := v_base_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := jsonb_build_object(
          'locationId', v_loc.location_id,
          'brandId', v_brand_id,
          'templateId', NEW.id
        )
      );
    END LOOP;
  END IF;

  -- Case 2: Recipe ingredients changed on a LIVE template → cascade to local mirrors
  IF TG_OP = 'UPDATE' 
     AND NEW.status = 'live' 
     AND NEW.recipe_ingredients IS DISTINCT FROM OLD.recipe_ingredients THEN

    FOR v_loc IN
      SELECT ii.id AS item_id, ii.location_id
      FROM inventory_items ii
      WHERE ii.brand_item_id = NEW.id
        AND ii.is_active = true
    LOOP
      -- Delete old local ingredients for this recipe item
      DELETE FROM inventory_recipe_ingredients
      WHERE recipe_item_id = v_loc.item_id;

      -- Re-insert from template using best-effort ingredient matching
      INSERT INTO inventory_recipe_ingredients (recipe_item_id, ingredient_item_id, quantity, unit)
      SELECT 
        v_loc.item_id,
        match.id,
        (ing->>'quantity')::numeric,
        ing->>'unit'
      FROM jsonb_array_elements(NEW.recipe_ingredients) AS ing
      CROSS JOIN LATERAL (
        SELECT ii2.id
        FROM inventory_items ii2
        WHERE ii2.location_id = v_loc.location_id
          AND ii2.is_active = true
          AND (
            (ing->>'ingredient_item_number' IS NOT NULL 
             AND lower(trim(ii2.item_number)) = lower(trim(ing->>'ingredient_item_number')))
            OR
            (ing->>'ingredient_pa_item_id' IS NOT NULL 
             AND lower(trim(ii2.pa_item_id)) = lower(trim(ing->>'ingredient_pa_item_id')))
            OR
            (ing->>'ingredient_name' IS NOT NULL 
             AND lower(ii2.name) = lower(ing->>'ingredient_name'))
          )
        LIMIT 1
      ) AS match;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
