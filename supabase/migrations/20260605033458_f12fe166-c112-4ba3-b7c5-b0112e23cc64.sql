CREATE OR REPLACE FUNCTION public.clone_count_to_sandbox(_source_location_id uuid, _source_count_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _sandbox_location_id uuid;
  _new_count_id uuid := gen_random_uuid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_see_admin_locations(_user_id) THEN
    RAISE EXCEPTION 'Insufficient privileges';
  END IF;

  SELECT id INTO _sandbox_location_id
  FROM public.locations
  WHERE requires_super_admin = true
    AND name = 'Sandbox'
  LIMIT 1;

  IF _sandbox_location_id IS NULL THEN
    RAISE EXCEPTION 'No Sandbox location found. Create a location named "Sandbox" with requires_super_admin=true.';
  END IF;

  DELETE FROM public.inventory_count_item_legs
   WHERE count_item_id IN (
     SELECT ici.id
     FROM public.inventory_count_items ici
     JOIN public.inventory_counts ic ON ic.id = ici.count_id
     WHERE ic.is_sandbox = true
       AND ic.sandbox_owner = _user_id
   );

  DELETE FROM public.inventory_count_items
   WHERE count_id IN (
     SELECT id
     FROM public.inventory_counts
     WHERE is_sandbox = true
       AND sandbox_owner = _user_id
   );

  DELETE FROM public.inventory_counts
   WHERE is_sandbox = true
     AND sandbox_owner = _user_id;

  DELETE FROM public.location_pack_selections
   WHERE location_id = _sandbox_location_id;

  DELETE FROM public.inventory_items
   WHERE location_id = _sandbox_location_id;

  DELETE FROM public.inventory_locations
   WHERE location_id = _sandbox_location_id;

  CREATE TEMP TABLE _loc_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _item_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _count_item_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;

  WITH src AS (
    SELECT il.*, gen_random_uuid() AS new_id
    FROM public.inventory_locations il
    WHERE il.location_id = _source_location_id
  )
  INSERT INTO _loc_map (old_id, new_id)
  SELECT id, new_id FROM src;

  INSERT INTO public.inventory_locations (
    id, location_id, name, display_order, created_at, updated_at
  )
  SELECT lm.new_id, _sandbox_location_id, src.name, src.display_order, now(), now()
  FROM public.inventory_locations src
  JOIN _loc_map lm ON lm.old_id = src.id;

  WITH src AS (
    SELECT i.*, gen_random_uuid() AS new_id, lm.new_id AS new_storage_id
    FROM public.inventory_items i
    LEFT JOIN _loc_map lm ON lm.old_id = i.storage_location_id
    WHERE i.location_id = _source_location_id
  )
  INSERT INTO _item_map (old_id, new_id)
  SELECT id, new_id FROM src;

  INSERT INTO public.inventory_items (
    id, location_id, storage_location_id, name, unit, par_level, cost_per_unit,
    qubeyond_item_id, display_order, is_active, created_at, updated_at,
    pack_size, pack_quantity, brand, item_number, image_url, pack_quantity_override,
    count_unit, count_units_per_case, is_recipe, recipe_yield_qty, recipe_yield_unit,
    category, last_synced_at, pa_item_id, vendor_source, remap_status, pan_sizes,
    user_hidden, linked_item_id, blended_price, countable, is_daily_tracked, source,
    brand_item_id, deactivated_by, deactivated_reason, last_seen_on_bid_list,
    last_seen_on_bid_list_vendor, available_since, manually_activated,
    attention_acknowledged, brand_archived_at, days_not_seen,
    inner_pack_quantity, inner_pack_label
  )
  SELECT
    im.new_id,
    _sandbox_location_id,
    lm.new_id,
    i.name,
    i.unit,
    i.par_level,
    i.cost_per_unit,
    i.qubeyond_item_id,
    i.display_order,
    i.is_active,
    now(),
    now(),
    i.pack_size,
    i.pack_quantity,
    i.brand,
    i.item_number,
    i.image_url,
    i.pack_quantity_override,
    i.count_unit,
    i.count_units_per_case,
    i.is_recipe,
    i.recipe_yield_qty,
    i.recipe_yield_unit,
    i.category,
    i.last_synced_at,
    i.pa_item_id,
    i.vendor_source,
    i.remap_status,
    i.pan_sizes,
    i.user_hidden,
    i.linked_item_id,
    i.blended_price,
    i.countable,
    i.is_daily_tracked,
    i.source,
    i.brand_item_id,
    i.deactivated_by,
    i.deactivated_reason,
    i.last_seen_on_bid_list,
    i.last_seen_on_bid_list_vendor,
    i.available_since,
    i.manually_activated,
    i.attention_acknowledged,
    i.brand_archived_at,
    i.days_not_seen,
    i.inner_pack_quantity,
    i.inner_pack_label
  FROM public.inventory_items i
  JOIN _item_map im ON im.old_id = i.id
  LEFT JOIN _loc_map lm ON lm.old_id = i.storage_location_id;

  INSERT INTO public.location_pack_selections (
    location_id, brand_template_id, active_pack_config_id, is_default, selected_by, selected_at
  )
  SELECT
    _sandbox_location_id,
    lps.brand_template_id,
    lps.active_pack_config_id,
    lps.is_default,
    lps.selected_by,
    lps.selected_at
  FROM public.location_pack_selections lps
  WHERE lps.location_id = _source_location_id;

  INSERT INTO public.inventory_counts (
    id, location_id, counted_by, count_date, status, started_at, completed_at,
    notes, created_at, period_type, period_end_date, duration_seconds, counted_at,
    is_late_close, late_close_notes, sales_end_override, locked_at, locked_by,
    sales_start_override, is_sandbox, sandbox_owner, cloned_from_location_id,
    cloned_from_count_id, cloned_at
  )
  SELECT
    _new_count_id,
    _sandbox_location_id,
    _user_id,
    ic.count_date,
    'in_progress',
    now(),
    NULL,
    ic.notes,
    now(),
    ic.period_type,
    ic.period_end_date,
    NULL,
    NULL,
    ic.is_late_close,
    ic.late_close_notes,
    ic.sales_end_override,
    NULL,
    NULL,
    ic.sales_start_override,
    true,
    _user_id,
    _source_location_id,
    _source_count_id,
    now()
  FROM public.inventory_counts ic
  WHERE ic.id = _source_count_id;

  WITH src AS (
    SELECT
      ci.*, 
      gen_random_uuid() AS new_id,
      im.new_id AS new_item_id,
      lm.new_id AS new_storage_id
    FROM public.inventory_count_items ci
    LEFT JOIN _item_map im ON im.old_id = ci.item_id
    LEFT JOIN _loc_map lm ON lm.old_id = ci.storage_location_id
    WHERE ci.count_id = _source_count_id
  ),
  ins AS (
    INSERT INTO public.inventory_count_items (
      id, count_id, item_id, quantity, theoretical_quantity, variance, variance_cost,
      counted_at, storage_location_id, entered_cases, entered_units, item_name_at_count,
      cost_at_count, unit_at_count, pack_quantity_at_count, pan_sizes_at_count,
      pan_inputs, entered_inner_packs, inner_pack_quantity_at_count, quantity_rollup_blocked
    )
    SELECT
      src.new_id,
      _new_count_id,
      src.new_item_id,
      src.quantity,
      src.theoretical_quantity,
      src.variance,
      src.variance_cost,
      src.counted_at,
      src.new_storage_id,
      src.entered_cases,
      src.entered_units,
      src.item_name_at_count,
      src.cost_at_count,
      src.unit_at_count,
      src.pack_quantity_at_count,
      src.pan_sizes_at_count,
      src.pan_inputs,
      src.entered_inner_packs,
      src.inner_pack_quantity_at_count,
      src.quantity_rollup_blocked
    FROM src
    RETURNING id
  )
  INSERT INTO _count_item_map (old_id, new_id)
  SELECT src.id, src.new_id FROM src;

  INSERT INTO public.inventory_count_item_legs (
    id, count_item_id, pack_config_id, is_default, entered_cases, entered_inner_packs,
    entered_units, quantity_common, pack_quantity_at_count, inner_pack_quantity_at_count,
    cost_at_count, common_unit_at_count, created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    cim.new_id,
    l.pack_config_id,
    l.is_default,
    l.entered_cases,
    l.entered_inner_packs,
    l.entered_units,
    l.quantity_common,
    l.pack_quantity_at_count,
    l.inner_pack_quantity_at_count,
    l.cost_at_count,
    l.common_unit_at_count,
    now(),
    now()
  FROM public.inventory_count_item_legs l
  JOIN _count_item_map cim ON cim.old_id = l.count_item_id;

  RETURN _new_count_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clone_count_to_sandbox(uuid, uuid) TO authenticated;