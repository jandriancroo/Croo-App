CREATE OR REPLACE FUNCTION public.clone_count_to_sandbox(_source_location_id uuid, _source_count_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE requires_super_admin = true AND name = 'Sandbox'
  LIMIT 1;

  IF _sandbox_location_id IS NULL THEN
    RAISE EXCEPTION 'No Sandbox location found. Create a location named "Sandbox" with requires_super_admin=true.';
  END IF;

  -- Wipe previous sandbox count owned by this user
  DELETE FROM public.inventory_count_item_legs
   WHERE count_item_id IN (
     SELECT ici.id FROM public.inventory_count_items ici
     JOIN public.inventory_counts ic ON ic.id = ici.count_id
     WHERE ic.is_sandbox = true AND ic.sandbox_owner = _user_id
   );
  DELETE FROM public.inventory_count_items
   WHERE count_id IN (
     SELECT id FROM public.inventory_counts
     WHERE is_sandbox = true AND sandbox_owner = _user_id
   );
  DELETE FROM public.inventory_counts
   WHERE is_sandbox = true AND sandbox_owner = _user_id;

  DELETE FROM public.location_pack_selections WHERE location_id = _sandbox_location_id;
  DELETE FROM public.inventory_items WHERE location_id = _sandbox_location_id;
  DELETE FROM public.inventory_locations WHERE location_id = _sandbox_location_id;

  CREATE TEMP TABLE _loc_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _item_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE _count_item_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL) ON COMMIT DROP;

  -- 1) Clone inventory_locations (storage areas) -- uses display_order
  WITH src AS (
    SELECT *, gen_random_uuid() AS new_id
    FROM public.inventory_locations
    WHERE location_id = _source_location_id
  ),
  ins AS (
    INSERT INTO public.inventory_locations (id, location_id, name, display_order, created_at, updated_at)
    SELECT new_id, _sandbox_location_id, name, display_order, now(), now()
    FROM src
    RETURNING id
  )
  INSERT INTO _loc_map (old_id, new_id) SELECT id, new_id FROM src;

  -- 2) Clone inventory_items
  WITH src AS (
    SELECT i.*, gen_random_uuid() AS new_id, lm.new_id AS new_storage_id
    FROM public.inventory_items i
    LEFT JOIN _loc_map lm ON lm.old_id = i.storage_location_id
    WHERE i.location_id = _source_location_id
  ),
  ins AS (
    INSERT INTO public.inventory_items (
      id, location_id, storage_location_id, name, unit, cost_per_unit,
      pack_quantity, inner_pack_quantity, brand_item_id, category, is_active,
      created_at, updated_at
    )
    SELECT new_id, _sandbox_location_id, new_storage_id, name, unit, cost_per_unit,
           pack_quantity, inner_pack_quantity, brand_item_id, category, is_active,
           now(), now()
    FROM src
    RETURNING id
  )
  INSERT INTO _item_map (old_id, new_id) SELECT id, new_id FROM src;

  -- 3) Clone location_pack_selections (composite PK on location_id+brand_template_id)
  INSERT INTO public.location_pack_selections (
    location_id, brand_template_id, active_pack_config_id, is_default, selected_by, selected_at
  )
  SELECT _sandbox_location_id, brand_template_id, active_pack_config_id, is_default, selected_by, selected_at
  FROM public.location_pack_selections
  WHERE location_id = _source_location_id;

  -- 4) Clone the inventory_counts row itself
  INSERT INTO public.inventory_counts (
    id, location_id, counted_by, count_date, status, started_at, completed_at,
    notes, period_type, period_end_date, duration_seconds, counted_at,
    is_late_close, late_close_notes, sales_start_override, sales_end_override,
    is_sandbox, sandbox_owner, cloned_from_location_id, cloned_from_count_id, cloned_at
  )
  SELECT _new_count_id, _sandbox_location_id, _user_id, count_date, status, now(), completed_at,
         notes, period_type, period_end_date, duration_seconds, counted_at,
         is_late_close, late_close_notes, sales_start_override, sales_end_override,
         true, _user_id, _source_location_id, _source_count_id, now()
  FROM public.inventory_counts
  WHERE id = _source_count_id;

  -- 5) Clone inventory_count_items
  WITH src AS (
    SELECT ici.*,
           gen_random_uuid() AS new_id,
           im.new_id AS new_item_id,
           lm.new_id AS new_storage_id
    FROM public.inventory_count_items ici
    LEFT JOIN _item_map im ON im.old_id = ici.item_id
    LEFT JOIN _loc_map lm ON lm.old_id = ici.storage_location_id
    WHERE ici.count_id = _source_count_id
  ),
  ins AS (
    INSERT INTO public.inventory_count_items (
      id, count_id, item_id, storage_location_id, quantity, theoretical_quantity,
      variance, variance_cost, counted_at, entered_cases, entered_units, entered_inner_packs,
      item_name_at_count, cost_at_count, unit_at_count, pack_quantity_at_count,
      inner_pack_quantity_at_count, pan_sizes_at_count, pan_inputs, quantity_rollup_blocked
    )
    SELECT new_id, _new_count_id, new_item_id, new_storage_id, quantity, theoretical_quantity,
           variance, variance_cost, counted_at, entered_cases, entered_units, entered_inner_packs,
           item_name_at_count, cost_at_count, unit_at_count, pack_quantity_at_count,
           inner_pack_quantity_at_count, pan_sizes_at_count, pan_inputs, quantity_rollup_blocked
    FROM src
    RETURNING id
  )
  INSERT INTO _count_item_map (old_id, new_id) SELECT id, new_id FROM src;

  -- 6) Clone inventory_count_item_legs
  INSERT INTO public.inventory_count_item_legs (
    id, count_item_id, pack_config_id, is_default, entered_cases, entered_inner_packs,
    entered_units, quantity_common, pack_quantity_at_count, inner_pack_quantity_at_count,
    cost_at_count, common_unit_at_count
  )
  SELECT gen_random_uuid(), cim.new_id, l.pack_config_id, l.is_default,
         l.entered_cases, l.entered_inner_packs, l.entered_units, l.quantity_common,
         l.pack_quantity_at_count, l.inner_pack_quantity_at_count,
         l.cost_at_count, l.common_unit_at_count
  FROM public.inventory_count_item_legs l
  JOIN _count_item_map cim ON cim.old_id = l.count_item_id;

  RETURN _new_count_id;
END;
$function$;