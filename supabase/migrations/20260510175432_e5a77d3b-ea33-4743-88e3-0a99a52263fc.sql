-- 1. heal_orphan_blueprint fix
CREATE OR REPLACE FUNCTION public.heal_orphan_blueprint(_blueprint_id uuid, _target_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_blueprint        recipe_blueprints%ROWTYPE;
  v_caller           uuid := auth.uid();
  v_template_id      uuid;
  v_item_id          uuid;
  v_loc              uuid;
  v_brand_id         uuid;
  v_category         text;
  v_vendor_source    text;
  v_brand_blueprint_id uuid;
  v_created_template boolean := false;
  v_created_item     boolean := false;
  v_created_brand_blueprint boolean := false;
  v_authorized       boolean := false;
BEGIN
  SELECT * INTO v_blueprint FROM recipe_blueprints WHERE id = _blueprint_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Blueprint % not found', _blueprint_id; END IF;

  v_brand_id := v_blueprint.brand_id;
  IF v_brand_id IS NULL AND v_blueprint.location_id IS NOT NULL THEN
    SELECT o.brand_id INTO v_brand_id
    FROM locations l JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = v_blueprint.location_id;
  END IF;

  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'Blueprint % has no brand context; cannot heal', _blueprint_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = v_caller AND ur.role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM brand_members bm WHERE bm.user_id = v_caller AND bm.brand_id = v_brand_id
  ) OR EXISTS (
    SELECT 1 FROM user_locations ul
    JOIN locations l ON l.id = ul.location_id
    JOIN organizations o ON o.id = l.organization_id
    JOIN user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.user_id = v_caller AND o.brand_id = v_brand_id
      AND ur.role IN ('admin','manager','org_admin','super_admin','brand_admin')
  ) INTO v_authorized;

  IF NOT v_authorized THEN RAISE EXCEPTION 'Not authorized to heal blueprint for this brand'; END IF;

  v_loc := COALESCE(_target_location_id, v_blueprint.location_id);
  v_category := COALESCE(NULLIF(v_blueprint.category, ''), 'PREP');
  v_vendor_source := 'recipe:' || v_blueprint.id::text;

  SELECT id INTO v_template_id
  FROM brand_inventory_templates
  WHERE brand_id = v_brand_id AND lower(product_name) = lower(v_blueprint.name) AND is_recipe = true
  LIMIT 1;

  IF v_template_id IS NULL THEN
    INSERT INTO brand_inventory_templates (
      brand_id, product_name, category, vendor_source, status,
      is_recipe, recipe_yield_qty, recipe_yield_unit, created_by
    ) VALUES (
      v_brand_id, v_blueprint.name, v_category, v_vendor_source, 'draft',
      true, v_blueprint.yield_qty, v_blueprint.yield_unit, v_caller
    ) RETURNING id INTO v_template_id;
    v_created_template := true;
  END IF;

  -- ARCHITECTURAL FIX: clone local blueprint to brand level instead of mutating it
  IF v_blueprint.location_id IS NOT NULL AND v_blueprint.brand_id IS NULL THEN
    SELECT id INTO v_brand_blueprint_id
    FROM recipe_blueprints
    WHERE brand_id = v_brand_id AND location_id IS NULL
      AND lower(name) = lower(v_blueprint.name) AND is_active = true
    LIMIT 1;

    IF v_brand_blueprint_id IS NULL THEN
      INSERT INTO recipe_blueprints (
        location_id, brand_id, name, category, yield_qty, yield_unit,
        produces_item_id, source, r365_name, is_active, catalog_section,
        recipe_type, is_countable
      ) VALUES (
        NULL, v_brand_id, v_blueprint.name, v_blueprint.category,
        v_blueprint.yield_qty, v_blueprint.yield_unit,
        NULL, COALESCE(v_blueprint.source, 'manual'), v_blueprint.r365_name,
        true, v_blueprint.catalog_section,
        v_blueprint.recipe_type, v_blueprint.is_countable
      ) RETURNING id INTO v_brand_blueprint_id;
      v_created_brand_blueprint := true;

      INSERT INTO recipe_blueprint_ingredients (
        blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id,
        quantity, unit, source_name
      )
      SELECT v_brand_blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id,
             quantity, unit, source_name
      FROM recipe_blueprint_ingredients WHERE blueprint_id = v_blueprint.id;
    END IF;
  ELSE
    v_brand_blueprint_id := v_blueprint.id;
  END IF;

  IF v_blueprint.produces_item_id IS NOT NULL THEN
    UPDATE inventory_items SET brand_item_id = v_template_id
    WHERE id = v_blueprint.produces_item_id AND brand_item_id IS DISTINCT FROM v_template_id;
    v_item_id := v_blueprint.produces_item_id;
  ELSIF v_loc IS NOT NULL THEN
    SELECT id INTO v_item_id FROM inventory_items
    WHERE location_id = v_loc AND brand_item_id = v_template_id AND is_active = true LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO inventory_items (
        location_id, brand_item_id, name, unit, is_active, is_recipe, countable,
        recipe_yield_qty, recipe_yield_unit, count_unit, count_units_per_case, display_order
      ) VALUES (
        v_loc, v_template_id, v_blueprint.name, v_blueprint.yield_unit,
        false, true, true, v_blueprint.yield_qty, v_blueprint.yield_unit, v_blueprint.yield_unit,
        v_blueprint.yield_qty, 0
      ) RETURNING id INTO v_item_id;
      v_created_item := true;
    END IF;

    IF v_blueprint.location_id IS NOT NULL THEN
      UPDATE recipe_blueprints SET produces_item_id = v_item_id, updated_at = now()
      WHERE id = v_blueprint.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'blueprint_id', v_blueprint.id,
    'brand_template_id', v_template_id,
    'brand_blueprint_id', v_brand_blueprint_id,
    'produces_item_id', v_item_id,
    'created_template', v_created_template,
    'created_item', v_created_item,
    'created_brand_blueprint', v_created_brand_blueprint
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.heal_orphan_blueprint(uuid, uuid) TO authenticated;

-- 2. DATA REPAIR: Balsamic — archive duplicate FIRST, then reactivate costed item
UPDATE inventory_items SET is_active = false, updated_at = now()
WHERE id = 'ea90d326-0bdc-4d64-9cc6-960e4ab430be';

UPDATE inventory_items SET is_active = true, updated_at = now()
WHERE id = '0bd89299-57d9-4b43-8f60-c301bfdc82f2';

-- Strip the bad brand_id from the Hemet local blueprint
UPDATE recipe_blueprints SET brand_id = NULL, updated_at = now()
WHERE id = '501bf6a8-d948-464d-ba11-6cf867e86b38';

-- Create the missing brand-level blueprint (clone of local), if not present
DO $$
DECLARE v_new_id uuid; v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM recipe_blueprints
  WHERE brand_id = '5f805404-cc7b-454b-a994-fe5901c32e6a'
    AND location_id IS NULL
    AND lower(name) = lower('Balsamic Caramelized Onion')
    AND is_active = true LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO recipe_blueprints (
      location_id, brand_id, name, category, yield_qty, yield_unit,
      produces_item_id, source, is_active, catalog_section, recipe_type, is_countable
    )
    SELECT NULL, '5f805404-cc7b-454b-a994-fe5901c32e6a',
           name, category, yield_qty, yield_unit,
           NULL, COALESCE(source, 'manual'), true, catalog_section,
           recipe_type, is_countable
    FROM recipe_blueprints WHERE id = '501bf6a8-d948-464d-ba11-6cf867e86b38'
    RETURNING id INTO v_new_id;

    INSERT INTO recipe_blueprint_ingredients (
      blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id,
      quantity, unit, source_name
    )
    SELECT v_new_id, ingredient_type, vendor_item_id, sub_blueprint_id,
           quantity, unit, source_name
    FROM recipe_blueprint_ingredients
    WHERE blueprint_id = '501bf6a8-d948-464d-ba11-6cf867e86b38';
  END IF;
END $$;

-- 3. DATA REPAIR: Archive the empty Prosciutto Pizza MI duplicate
UPDATE recipe_blueprints SET is_active = false, updated_at = now()
WHERE id = '10bf0f9c-02cf-4c2a-b7be-b7d7d65a1a46';