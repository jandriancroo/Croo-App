CREATE POLICY "Brand counters can view conversions"
ON public.item_conversions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.locations l
  WHERE l.brand_id = item_conversions.brand_id AND public.has_location_access(auth.uid(), l.id)));

CREATE OR REPLACE FUNCTION public._rc_caller_can_read_brand(_brand_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = _brand_id AND bm.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.locations l WHERE l.brand_id = _brand_id AND public.has_location_access(auth.uid(), l.id))
$$;

CREATE OR REPLACE FUNCTION public.brand_conversion_count(_brand_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._rc_caller_can_read_brand(_brand_id) THEN RETURN 0; END IF;
  RETURN (SELECT count(*)::int FROM public.item_conversions WHERE brand_id = _brand_id AND effective_to IS NULL);
END $$;

CREATE OR REPLACE FUNCTION public._rc_unit_key(_u text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN c IS NULL OR c = '' THEN ''
    WHEN c IN ('oz','oz-wt','oz-fl','fl-oz','floz','ounce','ounces') THEN 'oz'
    WHEN c IN ('lb','lbs','pound','pounds') THEN 'lb'
    WHEN c IN ('g','gram','grams') THEN 'g'
    WHEN c IN ('kg','kgs','kilogram','kilograms') THEN 'kg'
    WHEN c IN ('tsp','teaspoon','teaspoons','t') THEN 'tsp'
    WHEN c IN ('tbsp','tablespoon','tablespoons') THEN 'tbsp'
    WHEN c IN ('cup','cups') THEN 'cup'
    WHEN c IN ('pt','pint','pints') THEN 'pt'
    WHEN c IN ('qt','quart','quarts') THEN 'qt'
    WHEN c IN ('gal','ga','gallon','gallons') THEN 'gal'
    WHEN c IN ('l','liter','liters','litre','litres') THEN 'l'
    WHEN c IN ('ml','milliliter','milliliters') THEN 'ml'
    WHEN c IN ('cl','centiliter','centiliters') THEN 'cl'
    WHEN c IN ('ea','each','count','ct','pc','pcs','rl','roll') THEN 'ea'
    WHEN c IN ('cn','can','cans') THEN 'cn'
    WHEN c IN ('cs','case','cases') THEN 'cs'
    ELSE c END
  FROM (SELECT replace(lower(regexp_replace(coalesce(_u,''), '\s+', '', 'g')), '_', '-') AS c) x
$$;

CREATE OR REPLACE FUNCTION public._rc_oz(_key text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _key WHEN 'oz' THEN 1 WHEN 'lb' THEN 16 WHEN 'tsp' THEN 0.1667 WHEN 'tbsp' THEN 0.5
    WHEN 'cup' THEN 8 WHEN 'pt' THEN 16 WHEN 'qt' THEN 32 WHEN 'gal' THEN 128
    WHEN 'g' THEN 0.03527 WHEN 'kg' THEN 35.274 WHEN 'ml' THEN 0.033814 WHEN 'cl' THEN 0.33814 WHEN 'l' THEN 33.814
    ELSE NULL END::numeric
$$;

CREATE OR REPLACE FUNCTION public._rc_hash_can_oz(_n text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _n WHEN '1' THEN 11 WHEN '2' THEN 20 WHEN '2.5' THEN 29 WHEN '3' THEN 33 WHEN '5' THEN 56 WHEN '10' THEN 104 ELSE NULL END::numeric
$$;

-- Expand "bottle(20oz-fl)", "#10can" into (qty, unit key)
CREATE OR REPLACE FUNCTION public._rc_expand(_qty numeric, _unit text, OUT q numeric, OUT u text)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE c text := lower(regexp_replace(coalesce(_unit,''), '\s+', '', 'g')); m text[];
BEGIN
  m := regexp_match(c, '^#(\d+(?:\.\d+)?)can$');
  IF m IS NOT NULL AND public._rc_hash_can_oz(m[1]) IS NOT NULL THEN
    q := _qty * public._rc_hash_can_oz(m[1]); u := 'oz'; RETURN; END IF;
  m := regexp_match(c, '\(([\d.]+)([a-z-]+)\)');
  IF m IS NOT NULL AND public._rc_oz(public._rc_unit_key(m[2])) IS NOT NULL THEN
    q := _qty * m[1]::numeric; u := public._rc_unit_key(m[2]); RETURN; END IF;
  q := _qty; u := public._rc_unit_key(_unit);
END $$;

-- Total oz in one case from a store pack string like "4/1GA", "1/1 LB", "6/#10 CN", "18/36.8OZ"
CREATE OR REPLACE FUNCTION public._rc_pack_oz(_pack text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE m text[]; f numeric;
BEGIN
  IF _pack IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(_pack, '^\s*(\d*\.?\d+)\s*/\s*(#?)(\d*\.?\d+)\s*([A-Za-z-]+)');
  IF m IS NULL THEN
    m := regexp_match(_pack, '^\s*()()(\d*\.?\d+)\s*([A-Za-z-]+)\s*$');
    IF m IS NULL THEN RETURN NULL; END IF;
    m[1] := '1';
  END IF;
  IF m[2] = '#' THEN
    f := public._rc_hash_can_oz(m[3]);
    RETURN CASE WHEN f IS NULL THEN NULL ELSE m[1]::numeric * f END;
  END IF;
  f := public._rc_oz(public._rc_unit_key(m[4]));
  IF f IS NULL THEN RETURN NULL; END IF;
  RETURN m[1]::numeric * m[3]::numeric * f;
END $$;

-- Resolve a blueprint to the brand-level version (same brand + name), else itself
CREATE OR REPLACE FUNCTION public._rc_brand_bp(_bp_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT b.id FROM public.recipe_blueprints s JOIN public.recipe_blueprints b
       ON b.brand_id = s.brand_id AND b.location_id IS NULL AND lower(b.name) = lower(s.name) AND b.is_active
     WHERE s.id = _bp_id AND s.location_id IS NOT NULL ORDER BY b.updated_at DESC LIMIT 1),
    _bp_id)
$$;

-- Batch cost of one blueprint using a store's own items. Returns jsonb {cost, complete, missing[], unpriced[]}
CREATE OR REPLACE FUNCTION public._rc_batch(_bp_id uuid, _location_id uuid, _visited uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; total numeric := 0; missing text[] := '{}'; unpriced text[] := '{}';
  ex record; price numeric; divisor numeric; nm text; sub jsonb; sub_id uuid; sb record; yk text; qy numeric;
BEGIN
  IF _bp_id = ANY(_visited) THEN
    RETURN jsonb_build_object('cost', 0, 'complete', false, 'missing', jsonb_build_array('recipe loop'), 'unpriced', '[]'::jsonb);
  END IF;
  FOR r IN
    SELECT bi.*, coalesce(bi.source_name, t.common_name, t.product_name, 'ingredient') AS ing_name,
           si.id AS si_id, si.name AS si_name, si.cost_per_unit, si.blended_price, si.linked_item_id,
           si.pack_quantity, si.pack_size,
           c.outer_qty, c.canonical_qty_per_inner, c.canonical_unit
    FROM public.recipe_blueprint_ingredients bi
    LEFT JOIN public.brand_inventory_templates t ON t.id = bi.vendor_item_id
    LEFT JOIN LATERAL (SELECT * FROM public.inventory_items i
       WHERE i.location_id = _location_id AND i.brand_item_id = bi.vendor_item_id AND i.is_active
       ORDER BY i.updated_at DESC LIMIT 1) si ON bi.vendor_item_id IS NOT NULL
    LEFT JOIN LATERAL (SELECT * FROM public.item_conversions ic
       WHERE ic.brand_template_id = bi.vendor_item_id AND ic.effective_to IS NULL
       ORDER BY ic.version DESC LIMIT 1) c ON bi.vendor_item_id IS NOT NULL
    WHERE bi.blueprint_id = _bp_id
  LOOP
    ex := public._rc_expand(coalesce(r.quantity,0), r.unit);

    IF r.ingredient_type = 'blueprint' OR r.sub_blueprint_id IS NOT NULL THEN
      IF r.sub_blueprint_id IS NULL THEN missing := missing || r.ing_name; CONTINUE; END IF;
      sub_id := public._rc_brand_bp(r.sub_blueprint_id);
      SELECT name, yield_qty, yield_unit INTO sb FROM public.recipe_blueprints WHERE id = sub_id;
      IF NOT FOUND THEN missing := missing || r.ing_name; CONTINUE; END IF;
      sub := public._rc_batch(sub_id, _location_id, _visited || _bp_id);
      missing := missing || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'missing'));
      unpriced := unpriced || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'unpriced'));
      IF coalesce(sb.yield_qty,0) <= 0 THEN unpriced := unpriced || (sb.name || ' (no yield)'); CONTINUE; END IF;
      yk := public._rc_unit_key(sb.yield_unit);
      IF ex.u = yk THEN qy := ex.q;
      ELSIF public._rc_oz(ex.u) IS NOT NULL AND public._rc_oz(yk) IS NOT NULL THEN qy := ex.q * public._rc_oz(ex.u) / public._rc_oz(yk);
      ELSE unpriced := unpriced || (sb.name || ' (unit ' || coalesce(r.unit,'?') || ' vs ' || coalesce(sb.yield_unit,'?') || ')'); CONTINUE;
      END IF;
      total := total + (sub->>'cost')::numeric / sb.yield_qty * qy;
      CONTINUE;
    END IF;

    IF r.si_id IS NULL THEN missing := missing || r.ing_name; CONTINUE; END IF;
    nm := r.si_name;
    price := CASE WHEN r.linked_item_id IS NOT NULL AND r.blended_price IS NOT NULL THEN r.blended_price ELSE r.cost_per_unit END;
    IF price IS NULL THEN unpriced := unpriced || (nm || ' (no price)'); CONTINUE; END IF;

    IF ex.u = 'cs' THEN
      total := total + price * ex.q;
    ELSIF ex.u IN ('ea','cn') THEN
      divisor := CASE WHEN coalesce(r.pack_quantity,0) > 0 THEN r.pack_quantity ELSE nullif(r.outer_qty,0) END;
      IF divisor IS NULL THEN unpriced := unpriced || (nm || ' (no pack count)'); CONTINUE; END IF;
      total := total + price / divisor * ex.q;
    ELSIF public._rc_oz(ex.u) IS NOT NULL THEN
      divisor := public._rc_pack_oz(r.pack_size);
      IF divisor IS NULL AND r.outer_qty IS NOT NULL AND public._rc_oz(public._rc_unit_key(r.canonical_unit)) IS NOT NULL THEN
        divisor := r.outer_qty * coalesce(r.canonical_qty_per_inner, 1) * public._rc_oz(public._rc_unit_key(r.canonical_unit));
      END IF;
      IF coalesce(divisor,0) <= 0 THEN unpriced := unpriced || (nm || ' (no pack size)'); CONTINUE; END IF;
      total := total + price / divisor * ex.q * public._rc_oz(ex.u);
    ELSE
      unpriced := unpriced || (nm || ' (unknown unit ' || coalesce(r.unit,'?') || ')');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cost', total,
    'complete', coalesce(array_length(missing,1),0) = 0 AND coalesce(array_length(unpriced,1),0) = 0,
    'missing', to_jsonb(missing), 'unpriced', to_jsonb(unpriced));
END $$;

-- Dry run: proposed recipe costs for every store of a brand. Writes nothing.
CREATE OR REPLACE FUNCTION public.compute_recipe_costs(_brand_id uuid, _location_id uuid DEFAULT NULL)
RETURNS TABLE (
  location_id uuid, location_name text, item_id uuid, item_name text,
  old_cost numeric, computed_batch_cost numeric, proposed_cost numeric,
  old_yield_qty numeric, old_yield_unit text, brand_yield_qty numeric, brand_yield_unit text,
  cost_per_yield_unit numeric, status text, missing_ingredients text[], unpriced_ingredients text[], blueprint_id uuid
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE it record; bp_id uuid; bp record; res jsonb; ok boolean;
BEGIN
  IF NOT public._rc_caller_can_read_brand(_brand_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  FOR it IN
    SELECT i.id, i.name, i.cost_per_unit, i.recipe_yield_qty, i.recipe_yield_unit, l.id AS lid, l.name AS lname
    FROM public.inventory_items i JOIN public.locations l ON l.id = i.location_id
    WHERE l.brand_id = _brand_id AND coalesce(l.is_active, true)
      AND (_location_id IS NULL OR l.id = _location_id)
      AND i.is_active AND i.is_recipe
    ORDER BY l.name, i.name
  LOOP
    bp_id := (SELECT b.id FROM public.recipe_blueprints b WHERE b.produces_item_id = it.id
              ORDER BY b.is_active DESC, b.updated_at DESC LIMIT 1);
    IF bp_id IS NOT NULL THEN bp_id := public._rc_brand_bp(bp_id);
    ELSE
      bp_id := (SELECT b.id FROM public.recipe_blueprints b WHERE b.brand_id = _brand_id AND b.location_id IS NULL
                AND b.is_active AND lower(b.name) = lower(it.name) ORDER BY b.updated_at DESC LIMIT 1);
    END IF;
    IF bp_id IS NOT NULL THEN
      SELECT * INTO bp FROM public.recipe_blueprints WHERE id = bp_id;
      IF NOT bp.is_active THEN bp_id := NULL; END IF;
    END IF;

    location_id := it.lid; location_name := it.lname; item_id := it.id; item_name := it.name;
    old_cost := it.cost_per_unit; old_yield_qty := it.recipe_yield_qty; old_yield_unit := it.recipe_yield_unit;
    blueprint_id := bp_id;

    IF bp_id IS NULL THEN
      computed_batch_cost := NULL; proposed_cost := it.cost_per_unit; brand_yield_qty := NULL; brand_yield_unit := NULL;
      cost_per_yield_unit := NULL; status := 'no_recipe'; missing_ingredients := '{}'; unpriced_ingredients := '{}';
      RETURN NEXT; CONTINUE;
    END IF;

    res := public._rc_batch(bp_id, it.lid);
    ok := (res->>'complete')::boolean;
    computed_batch_cost := round((res->>'cost')::numeric, 4);
    brand_yield_qty := bp.yield_qty; brand_yield_unit := bp.yield_unit;
    cost_per_yield_unit := CASE WHEN ok AND coalesce(bp.yield_qty,0) > 0 THEN round((res->>'cost')::numeric / bp.yield_qty, 6) END;
    status := CASE WHEN ok THEN 'ok' ELSE 'incomplete' END;
    proposed_cost := CASE WHEN ok THEN computed_batch_cost ELSE it.cost_per_unit END;
    missing_ingredients := ARRAY(SELECT jsonb_array_elements_text(res->'missing'));
    unpriced_ingredients := ARRAY(SELECT jsonb_array_elements_text(res->'unpriced'));
    RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._rc_batch(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rc_brand_bp(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rc_caller_can_read_brand(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compute_recipe_costs(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_conversion_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_recipe_costs(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.brand_conversion_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._rc_caller_can_read_brand(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._rc_batch(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public._rc_brand_bp(uuid) TO service_role;