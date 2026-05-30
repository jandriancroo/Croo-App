CREATE OR REPLACE FUNCTION public.save_count_item_with_legs(p_count_item_id uuid, p_legs jsonb, p_freeze_snapshots boolean DEFAULT false, p_rollup_blocked boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default JSONB;
  v_parent_quantity NUMERIC;
  v_parent_cost NUMERIC;
BEGIN
  IF p_legs IS NULL OR jsonb_array_length(p_legs) = 0 THEN
    RAISE EXCEPTION 'save_count_item_with_legs requires at least one leg';
  END IF;

  DELETE FROM public.inventory_count_item_legs
   WHERE count_item_id = p_count_item_id;

  INSERT INTO public.inventory_count_item_legs (
    count_item_id, pack_config_id, is_default,
    entered_cases, entered_inner_packs, entered_units,
    quantity_common,
    pack_quantity_at_count, inner_pack_quantity_at_count,
    cost_at_count, common_unit_at_count
  )
  SELECT
    p_count_item_id,
    (leg->>'pack_config_id')::UUID,
    COALESCE((leg->>'is_default')::BOOLEAN, false),
    NULLIF(leg->>'entered_cases','')::NUMERIC,
    NULLIF(leg->>'entered_inner_packs','')::NUMERIC,
    NULLIF(leg->>'entered_units','')::NUMERIC,
    NULLIF(leg->>'quantity_common','')::NUMERIC,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'pack_quantity_at_count','')::NUMERIC END,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'inner_pack_quantity_at_count','')::NUMERIC END,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'cost_at_count','')::NUMERIC END,
    CASE WHEN p_freeze_snapshots THEN NULLIF(leg->>'common_unit_at_count','') END
  FROM jsonb_array_elements(p_legs) AS leg;

  SELECT COALESCE(SUM(quantity_common), 0)
    INTO v_parent_quantity
    FROM public.inventory_count_item_legs
   WHERE count_item_id = p_count_item_id;

  -- Per spec §3.3 every leg of one item shares the same cost_at_count.
  -- Parent rollup = the default leg's single cost (NOT SUM of all legs, which would N×-multiply).
  -- Fallback to MAX if no default leg exists (defensive — shouldn't happen post payload-fix).
  IF p_freeze_snapshots THEN
    SELECT d.cost_at_count
      INTO v_parent_cost
      FROM public.inventory_count_item_legs d
     WHERE d.count_item_id = p_count_item_id
       AND d.is_default = true
     LIMIT 1;

    IF v_parent_cost IS NULL THEN
      SELECT MAX(cost_at_count)
        INTO v_parent_cost
        FROM public.inventory_count_item_legs
       WHERE count_item_id = p_count_item_id;
    END IF;
  END IF;

  SELECT to_jsonb(d)
    INTO v_default
    FROM public.inventory_count_item_legs d
   WHERE d.count_item_id = p_count_item_id
     AND d.is_default = true
   LIMIT 1;

  UPDATE public.inventory_count_items ci
     SET quantity = CASE WHEN p_rollup_blocked THEN NULL ELSE v_parent_quantity END,
         quantity_rollup_blocked = p_rollup_blocked,
         entered_cases       = NULLIF(v_default->>'entered_cases','')::NUMERIC,
         entered_inner_packs = NULLIF(v_default->>'entered_inner_packs','')::NUMERIC,
         entered_units       = NULLIF(v_default->>'entered_units','')::NUMERIC,
         cost_at_count = CASE WHEN p_freeze_snapshots THEN v_parent_cost ELSE ci.cost_at_count END
   WHERE ci.id = p_count_item_id;

  RETURN jsonb_build_object(
    'count_item_id', p_count_item_id,
    'parent_quantity', v_parent_quantity,
    'rollup_blocked', p_rollup_blocked,
    'frozen', p_freeze_snapshots
  );
END;
$function$;