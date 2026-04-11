
-- Trigger function: auto-deploy when template status → 'live' or recipe changes on a live template
CREATE OR REPLACE FUNCTION public.auto_deploy_brand_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_brand_id uuid;
  v_loc RECORD;
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
        url := current_setting('app.settings.supabase_url', true) 
               || '/functions/v1/deploy-location-inventory',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
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

    -- For each location that has the local item for this template
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
            -- Match by item_number
            (ing->>'ingredient_item_number' IS NOT NULL 
             AND lower(trim(ii2.item_number)) = lower(trim(ing->>'ingredient_item_number')))
            OR
            -- Match by pa_item_id
            (ing->>'ingredient_pa_item_id' IS NOT NULL 
             AND lower(trim(ii2.pa_item_id)) = lower(trim(ing->>'ingredient_pa_item_id')))
            OR
            -- Match by name
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

-- Attach the trigger
DROP TRIGGER IF EXISTS trg_auto_deploy_brand_template ON brand_inventory_templates;
CREATE TRIGGER trg_auto_deploy_brand_template
  AFTER INSERT OR UPDATE OF status, recipe_ingredients
  ON brand_inventory_templates
  FOR EACH ROW
  EXECUTE FUNCTION auto_deploy_brand_template();
