CREATE OR REPLACE FUNCTION public.auto_deploy_brand_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_brand_id uuid;
  v_loc RECORD;
  v_base_url text := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/deploy-location-inventory';
  v_headers jsonb;
BEGIN
  v_brand_id := NEW.brand_id;
  v_headers := public.cron_edge_headers();

  -- Case 1: Template just went live (deploy item to all INVENTORY-ENABLED locations)
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'live' AND NEW.status = 'live')
     OR (TG_OP = 'INSERT' AND NEW.status = 'live') THEN

    FOR v_loc IN
      SELECT l.id AS location_id
      FROM locations l
      JOIN organizations o ON o.id = l.organization_id
      WHERE o.brand_id = v_brand_id
        AND l.is_active = true
        AND l.inventory_enabled = true
    LOOP
      PERFORM net.http_post(
        url := v_base_url,
        headers := v_headers,
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
      DELETE FROM inventory_recipe_ingredients
      WHERE recipe_item_id = v_loc.item_id;

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
$function$;