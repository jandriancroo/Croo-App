ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS cost_status text,
  ADD COLUMN IF NOT EXISTS cost_computed_at timestamptz;

CREATE OR REPLACE FUNCTION public._rc_caller_can_read_brand(_brand_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (auth.uid() IS NULL AND session_user NOT IN ('authenticator','anon','authenticated'))
    OR public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = _brand_id AND bm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.locations l WHERE l.brand_id = _brand_id AND public.has_location_access(auth.uid(), l.id))
$$;
REVOKE ALL ON FUNCTION public._rc_caller_can_read_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rc_caller_can_read_brand(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_recipe_costs(_brand_id uuid)
RETURNS TABLE (status text, items integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE now_ts timestamptz := now();
BEGIN
  IF NOT public._rc_caller_can_read_brand(_brand_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rc_apply ON COMMIT DROP AS
    SELECT * FROM public.compute_recipe_costs(_brand_id) WITH NO DATA;
  TRUNCATE _rc_apply;
  INSERT INTO _rc_apply SELECT * FROM public.compute_recipe_costs(_brand_id);

  -- ok: cost + brand yield together
  UPDATE public.inventory_items i SET
    cost_per_unit = r.proposed_cost,
    recipe_yield_qty = r.brand_yield_qty,
    recipe_yield_unit = r.brand_yield_unit,
    cost_status = 'ok', cost_computed_at = now_ts
  FROM _rc_apply r
  WHERE i.id = r.item_id AND r.status = 'ok' AND r.proposed_cost IS NOT NULL
    AND r.brand_yield_qty IS NOT NULL AND r.brand_yield_qty > 0;

  -- incomplete / no_recipe: keep cost and yield, stamp status only
  UPDATE public.inventory_items i SET cost_status = r.status, cost_computed_at = now_ts
  FROM _rc_apply r
  WHERE i.id = r.item_id AND r.status IN ('incomplete','no_recipe');

  -- orphaned blended prices at this brand's stores
  UPDATE public.inventory_items i SET blended_price = NULL
  FROM public.locations l
  WHERE l.id = i.location_id AND l.brand_id = _brand_id
    AND i.linked_item_id IS NULL AND i.blended_price IS NOT NULL;

  RETURN QUERY SELECT r.status, count(*)::int FROM _rc_apply r GROUP BY r.status;
END $$;

REVOKE ALL ON FUNCTION public.apply_recipe_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_recipe_costs(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_recipe_costs_all_brands()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b uuid;
BEGIN
  IF auth.uid() IS NOT NULL OR session_user IN ('authenticator','anon','authenticated') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  FOR b IN SELECT DISTINCT l.brand_id FROM public.inventory_items i JOIN public.locations l ON l.id = i.location_id
           WHERE i.is_active AND i.is_recipe AND l.brand_id IS NOT NULL AND coalesce(l.is_active, true)
  LOOP
    BEGIN
      PERFORM public.apply_recipe_costs(b);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'apply_recipe_costs failed for brand %: %', b, SQLERRM;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.apply_recipe_costs_all_brands() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_recipe_costs_all_brands() TO service_role;