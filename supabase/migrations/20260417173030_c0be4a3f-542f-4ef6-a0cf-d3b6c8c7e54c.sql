
-- Self-healing function: ensures an orphan recipe_blueprint gets a brand template + inventory item.
-- Returns the produces_item_id (existing or newly created).
-- Idempotent via vendor_source = 'r365:<blueprint_id>' marker.

CREATE OR REPLACE FUNCTION public.heal_orphan_blueprint(
  _blueprint_id uuid,
  _target_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blueprint RECORD;
  v_template_id uuid;
  v_item_id uuid;
  v_vendor_source text;
  v_category text;
  v_caller uuid := auth.uid();
  v_is_authorized boolean := false;
  v_created_template boolean := false;
  v_created_item boolean := false;
BEGIN
  -- Load blueprint
  SELECT id, brand_id, location_id, name, category, catalog_section, yield_qty, yield_unit, produces_item_id, source
  INTO v_blueprint
  FROM recipe_blueprints
  WHERE id = _blueprint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blueprint % not found', _blueprint_id;
  END IF;

  IF v_blueprint.brand_id IS NULL THEN
    RAISE EXCEPTION 'Blueprint % has no brand_id; cannot heal without a brand context', _blueprint_id;
  END IF;

  -- Authorization: super admin, brand member, or admin/manager of a location in this brand
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = v_caller AND role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM brand_members WHERE user_id = v_caller AND brand_id = v_blueprint.brand_id
  ) OR EXISTS (
    SELECT 1
    FROM user_locations ul
    JOIN locations l ON l.id = ul.location_id
    JOIN organizations o ON o.id = l.organization_id
    WHERE ul.user_id = v_caller
      AND o.brand_id = v_blueprint.brand_id
      AND ul.role IN ('admin', 'manager', 'org_admin', 'brand_admin')
  )
  INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized to heal blueprints in this brand';
  END IF;

  v_vendor_source := 'r365:' || v_blueprint.id::text;
  v_category := COALESCE(NULLIF(v_blueprint.catalog_section, ''), NULLIF(v_blueprint.category, ''), 'PREP');

  -- 1) Ensure brand_inventory_templates row exists (idempotency key = vendor_source)
  SELECT id INTO v_template_id
  FROM brand_inventory_templates
  WHERE brand_id = v_blueprint.brand_id
    AND vendor_source = v_vendor_source
  LIMIT 1;

  IF v_template_id IS NULL THEN
    INSERT INTO brand_inventory_templates (
      brand_id,
      product_name,
      category,
      vendor_source,
      status,
      is_recipe,
      recipe_yield_qty,
      recipe_yield_unit,
      created_by
    ) VALUES (
      v_blueprint.brand_id,
      v_blueprint.name,
      v_category,
      v_vendor_source,
      'active',
      true,
      v_blueprint.yield_qty,
      v_blueprint.yield_unit,
      v_caller
    )
    RETURNING id INTO v_template_id;
    v_created_template := true;
  END IF;

  -- 2) If blueprint already has produces_item_id, ensure that item is linked to the template, then return.
  IF v_blueprint.produces_item_id IS NOT NULL THEN
    UPDATE inventory_items
    SET brand_item_id = v_template_id
    WHERE id = v_blueprint.produces_item_id
      AND brand_item_id IS DISTINCT FROM v_template_id;

    RETURN jsonb_build_object(
      'blueprint_id', v_blueprint.id,
      'brand_template_id', v_template_id,
      'produces_item_id', v_blueprint.produces_item_id,
      'created_template', v_created_template,
      'created_item', false,
      'vendor_source', v_vendor_source
    );
  END IF;

  -- 3) Need to create / find an inventory_items row.
  --    Brand-level blueprint (no location_id) → no local item needed; just return template link.
  --    Location-level blueprint → create local item if a target location is provided or the bp has its own.
  DECLARE
    v_loc uuid := COALESCE(_target_location_id, v_blueprint.location_id);
  BEGIN
    IF v_loc IS NULL THEN
      -- Brand-level orphan: nothing to do at the location layer; backfill stops here.
      RETURN jsonb_build_object(
        'blueprint_id', v_blueprint.id,
        'brand_template_id', v_template_id,
        'produces_item_id', NULL,
        'created_template', v_created_template,
        'created_item', false,
        'vendor_source', v_vendor_source,
        'note', 'brand-level blueprint; no local item created'
      );
    END IF;

    -- Look for existing local item already linked to this template
    SELECT id INTO v_item_id
    FROM inventory_items
    WHERE location_id = v_loc
      AND brand_item_id = v_template_id
    ORDER BY is_active DESC, created_at DESC
    LIMIT 1;

    IF v_item_id IS NULL THEN
      INSERT INTO inventory_items (
        location_id,
        brand_item_id,
        name,
        unit,
        is_recipe,
        is_active,
        countable,
        recipe_yield_qty,
        recipe_yield_unit,
        count_unit,
        count_units_per_case,
        display_order
      ) VALUES (
        v_loc,
        v_template_id,
        v_blueprint.name,
        v_blueprint.yield_unit,
        false,
        true,
        true,
        v_blueprint.yield_qty,
        v_blueprint.yield_unit,
        v_blueprint.yield_unit,
        v_blueprint.yield_qty,
        0
      )
      RETURNING id INTO v_item_id;
      v_created_item := true;
    END IF;

    UPDATE recipe_blueprints
    SET produces_item_id = v_item_id,
        updated_at = now()
    WHERE id = v_blueprint.id;

    RETURN jsonb_build_object(
      'blueprint_id', v_blueprint.id,
      'brand_template_id', v_template_id,
      'produces_item_id', v_item_id,
      'created_template', v_created_template,
      'created_item', v_created_item,
      'vendor_source', v_vendor_source
    );
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.heal_orphan_blueprint(uuid, uuid) TO authenticated;
