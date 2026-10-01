-- One line of a vendor ingredient at one store (single source for costing + brand pricing)
CREATE OR REPLACE FUNCTION public._rc_item_line(_tpl uuid, _location_id uuid, _qty numeric, _unit text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE si record; c record; v record; ex record; price numeric; divisor numeric; lk text; lbl text;
BEGIN
  IF _tpl IS NULL THEN RETURN jsonb_build_object('missing', true); END IF;
  SELECT i.id, i.name, i.cost_per_unit, i.blended_price, i.linked_item_id, i.pack_quantity, i.pack_size INTO si
    FROM public.inventory_items i WHERE i.location_id = _location_id AND i.brand_item_id = _tpl AND i.is_active
    ORDER BY i.updated_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('missing', true); END IF;
  ex := public._rc_expand(coalesce(_qty,0), _unit);
  price := CASE WHEN si.linked_item_id IS NOT NULL AND si.blended_price IS NOT NULL THEN si.blended_price ELSE si.cost_per_unit END;
  IF price IS NULL THEN RETURN jsonb_build_object('name', si.name, 'problem', si.name || ' (no price)'); END IF;
  IF ex.u = 'cs' THEN RETURN jsonb_build_object('name', si.name, 'cost', price * ex.q, 'u', ex.u, 'q', ex.q); END IF;

  SELECT vl.count_units_per_case AS l_units, vl.common_unit AS l_unit, vl.outer_qty AS l_outer, vl.outer_type AS l_outer_type INTO v
    FROM public.v_store_pack_lens vl
    WHERE vl.location_id = _location_id AND vl.brand_template_id = _tpl AND coalesce(vl.count_units_per_case,0) > 0 LIMIT 1;
  IF FOUND THEN
    lk := public._rc_unit_key(v.l_unit);
    IF ex.u IN ('ea','cn') AND lk IN ('ea','cn') THEN
      divisor := v.l_units; lbl := trim(to_char(v.l_units,'FM999990.####')) || ' ' || v.l_unit || '/case';
    ELSIF ex.u IN ('ea','cn') AND coalesce(v.l_outer,0) > 0 THEN
      divisor := v.l_outer; lbl := v.l_outer || ' ' || coalesce(v.l_outer_type,'units') || '/case';
    ELSIF public._rc_oz(ex.u) IS NOT NULL AND public._rc_oz(lk) IS NOT NULL THEN
      divisor := v.l_units * public._rc_oz(lk); lbl := trim(to_char(v.l_units,'FM999990.####')) || ' ' || v.l_unit || '/case';
    ELSE
      RETURN jsonb_build_object('name', si.name, 'problem', si.name || ' (recipe unit ' || coalesce(_unit,'?') || ' vs store pack unit ' || coalesce(v.l_unit,'?') || ')');
    END IF;
    RETURN jsonb_build_object('name', si.name, 'u', ex.u, 'q', ex.q, 'lens', si.name || ': ' || lbl,
      'cost', CASE WHEN ex.u IN ('ea','cn') THEN price / divisor * ex.q ELSE price / divisor * ex.q * public._rc_oz(ex.u) END);
  END IF;

  -- Fallback: no store pack choice -> store pack fields, then brand conversion
  SELECT ic.outer_qty, ic.canonical_qty_per_inner, ic.canonical_unit INTO c FROM public.item_conversions ic
    WHERE ic.brand_template_id = _tpl AND ic.effective_to IS NULL ORDER BY ic.version DESC LIMIT 1;
  IF ex.u IN ('ea','cn') THEN
    divisor := CASE WHEN coalesce(si.pack_quantity,0) > 0 THEN si.pack_quantity ELSE nullif(c.outer_qty,0) END;
    IF divisor IS NULL THEN RETURN jsonb_build_object('name', si.name, 'problem', si.name || ' (no pack count)'); END IF;
    RETURN jsonb_build_object('name', si.name, 'u', ex.u, 'q', ex.q, 'cost', price / divisor * ex.q);
  ELSIF public._rc_oz(ex.u) IS NOT NULL THEN
    divisor := public._rc_pack_oz(si.pack_size);
    IF divisor IS NULL AND c.outer_qty IS NOT NULL AND public._rc_oz(public._rc_unit_key(c.canonical_unit)) IS NOT NULL THEN
      divisor := c.outer_qty * coalesce(c.canonical_qty_per_inner, 1) * public._rc_oz(public._rc_unit_key(c.canonical_unit));
    END IF;
    IF coalesce(divisor,0) <= 0 THEN RETURN jsonb_build_object('name', si.name, 'problem', si.name || ' (no pack size)'); END IF;
    RETURN jsonb_build_object('name', si.name, 'u', ex.u, 'q', ex.q, 'cost', price / divisor * ex.q * public._rc_oz(ex.u));
  END IF;
  RETURN jsonb_build_object('name', si.name, 'problem', si.name || ' (unknown unit ' || coalesce(_unit,'?') || ')');
END $$;

-- Recipe batch cost: the one costing path (store pack first, old pack source as fallback inside _rc_item_line)
CREATE OR REPLACE FUNCTION public._rc_batch(_bp_id uuid, _location_id uuid, _visited uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; total numeric := 0; missing text[] := '{}'; unpriced text[] := '{}'; lens_used text[] := '{}';
  ex record; sub jsonb; sub_id uuid; sb record; yk text; qy numeric; line jsonb;
BEGIN
  IF _bp_id = ANY(_visited) THEN
    RETURN jsonb_build_object('cost', 0, 'complete', false, 'missing', jsonb_build_array('recipe loop'), 'unpriced', '[]'::jsonb, 'lens', '[]'::jsonb);
  END IF;
  FOR r IN
    SELECT bi.*, coalesce(bi.source_name, t.common_name, t.product_name, 'ingredient') AS ing_name
    FROM public.recipe_blueprint_ingredients bi
    LEFT JOIN public.brand_inventory_templates t ON t.id = bi.vendor_item_id
    WHERE bi.blueprint_id = _bp_id
  LOOP
    IF r.ingredient_type = 'blueprint' OR r.sub_blueprint_id IS NOT NULL THEN
      IF r.sub_blueprint_id IS NULL THEN missing := missing || r.ing_name; CONTINUE; END IF;
      ex := public._rc_expand(coalesce(r.quantity,0), r.unit);
      sub_id := public._rc_brand_bp(r.sub_blueprint_id);
      SELECT name, yield_qty, yield_unit INTO sb FROM public.recipe_blueprints WHERE id = sub_id;
      IF NOT FOUND THEN missing := missing || r.ing_name; CONTINUE; END IF;
      sub := public._rc_batch(sub_id, _location_id, _visited || _bp_id);
      missing := missing || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'missing'));
      unpriced := unpriced || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'unpriced'));
      lens_used := lens_used || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(coalesce(sub->'lens','[]'::jsonb)));
      IF coalesce(sb.yield_qty,0) <= 0 THEN unpriced := unpriced || (sb.name || ' (no yield)'); CONTINUE; END IF;
      yk := public._rc_unit_key(sb.yield_unit);
      IF ex.u = yk THEN qy := ex.q;
      ELSIF public._rc_oz(ex.u) IS NOT NULL AND public._rc_oz(yk) IS NOT NULL THEN qy := ex.q * public._rc_oz(ex.u) / public._rc_oz(yk);
      ELSE unpriced := unpriced || (sb.name || ' (unit ' || coalesce(r.unit,'?') || ' vs ' || coalesce(sb.yield_unit,'?') || ')'); CONTINUE;
      END IF;
      total := total + (sub->>'cost')::numeric / sb.yield_qty * qy;
      CONTINUE;
    END IF;
    line := public._rc_item_line(r.vendor_item_id, _location_id, r.quantity, r.unit);
    IF coalesce((line->>'missing')::boolean, false) THEN missing := missing || r.ing_name; CONTINUE; END IF;
    IF line ? 'problem' THEN unpriced := unpriced || (line->>'problem'); CONTINUE; END IF;
    IF line ? 'lens' THEN lens_used := lens_used || (line->>'lens'); END IF;
    total := total + (line->>'cost')::numeric;
  END LOOP;
  RETURN jsonb_build_object('cost', total,
    'complete', coalesce(array_length(missing,1),0) = 0 AND coalesce(array_length(unpriced,1),0) = 0,
    'missing', to_jsonb(missing), 'unpriced', to_jsonb(unpriced), 'lens', to_jsonb(lens_used));
END $$;

DROP FUNCTION IF EXISTS public.preview_recipe_costs_lens(uuid, uuid);
DROP FUNCTION IF EXISTS public._rc_batch_lens(uuid, uuid, uuid[]);

REVOKE ALL ON FUNCTION public._rc_item_line(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rc_item_line(uuid, uuid, numeric, text) TO service_role;

-- Price of one unit line per store for brand view: per lb for weights, else per recipe unit
CREATE OR REPLACE FUNCTION public._rc_unit_label(_u text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _u IN ('g','kg','oz','lb') THEN 'lb' ELSE coalesce(_u,'unit') END $$;

-- Brand recipe pricing, view only. Median across stores that carry the item.
CREATE OR REPLACE FUNCTION public.brand_recipe_pricing(_bp_id uuid)
RETURNS TABLE (ingredient_id uuid, ingredient_name text, quantity numeric, unit text, is_sub boolean,
  median_cost numeric, min_cost numeric, max_cost numeric, stores_priced int,
  unit_label text, median_unit_price numeric, store_prices jsonb, outliers jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; r record; loc record; line jsonb; ex record; sub jsonb; sb record; yk text; qy numeric;
  arr jsonb; cost numeric; per numeric; med numeric; medu numeric; f numeric;
BEGIN
  SELECT * INTO b FROM public.recipe_blueprints WHERE id = _bp_id;
  IF NOT FOUND OR b.brand_id IS NULL OR NOT public._rc_caller_can_read_brand(b.brand_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT bi.*, coalesce(bi.source_name, t.common_name, t.product_name, sbp.name, 'ingredient') AS ing_name
    FROM public.recipe_blueprint_ingredients bi
    LEFT JOIN public.brand_inventory_templates t ON t.id = bi.vendor_item_id
    LEFT JOIN public.recipe_blueprints sbp ON sbp.id = bi.sub_blueprint_id
    WHERE bi.blueprint_id = _bp_id ORDER BY bi.id
  LOOP
    arr := '[]'::jsonb;
    ex := public._rc_expand(coalesce(r.quantity,0), r.unit);
    f := CASE WHEN ex.u IN ('g','kg','oz','lb') AND public._rc_oz(ex.u) IS NOT NULL AND ex.q > 0 THEN 16.0 / (ex.q * public._rc_oz(ex.u))
              WHEN ex.q > 0 THEN 1.0 / ex.q END;
    FOR loc IN SELECT l.id, l.name FROM public.locations l WHERE l.brand_id = b.brand_id AND l.is_active ORDER BY l.name LOOP
      cost := NULL; line := NULL;
      IF r.ingredient_type = 'blueprint' OR r.sub_blueprint_id IS NOT NULL THEN
        IF r.sub_blueprint_id IS NULL THEN CONTINUE; END IF;
        SELECT id, name, yield_qty, yield_unit INTO sb FROM public.recipe_blueprints WHERE id = public._rc_brand_bp(r.sub_blueprint_id);
        IF NOT FOUND OR coalesce(sb.yield_qty,0) <= 0 THEN CONTINUE; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.location_id = loc.id AND i.is_active) THEN CONTINUE; END IF;
        sub := public._rc_batch(sb.id, loc.id);
        yk := public._rc_unit_key(sb.yield_unit);
        qy := CASE WHEN ex.u = yk THEN ex.q WHEN public._rc_oz(ex.u) IS NOT NULL AND public._rc_oz(yk) IS NOT NULL THEN ex.q * public._rc_oz(ex.u) / public._rc_oz(yk) END;
        IF qy IS NULL THEN CONTINUE; END IF;
        IF (sub->>'complete')::boolean THEN cost := (sub->>'cost')::numeric / sb.yield_qty * qy;
        ELSE arr := arr || jsonb_build_object('store', loc.name, 'problem', 'sub-recipe incomplete'); CONTINUE; END IF;
      ELSE
        line := public._rc_item_line(r.vendor_item_id, loc.id, r.quantity, r.unit);
        IF coalesce((line->>'missing')::boolean, false) THEN CONTINUE; END IF;
        IF line ? 'problem' THEN arr := arr || jsonb_build_object('store', loc.name, 'problem', line->>'problem'); CONTINUE; END IF;
        cost := (line->>'cost')::numeric;
      END IF;
      arr := arr || jsonb_build_object('store', loc.name, 'cost', round(cost, 4), 'unit_price', round(cost * f, 4), 'lens', line->>'lens');
    END LOOP;
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (e->>'cost')::numeric), min((e->>'cost')::numeric), max((e->>'cost')::numeric), count(e->'cost')
      INTO med, min_cost, max_cost, stores_priced FROM jsonb_array_elements(arr) e WHERE e ? 'cost';
    medu := med * f;
    ingredient_id := r.id; ingredient_name := r.ing_name; quantity := r.quantity; unit := r.unit;
    is_sub := (r.ingredient_type = 'blueprint' OR r.sub_blueprint_id IS NOT NULL);
    median_cost := round(med, 4); unit_label := public._rc_unit_label(ex.u); median_unit_price := round(medu, 4);
    store_prices := arr;
    outliers := coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(arr) e
       WHERE e ? 'problem' OR (med > 0 AND abs((e->>'cost')::numeric / med - 1) > 0.5)), '[]'::jsonb);
    RETURN NEXT;
  END LOOP;
END $$;

-- Every flagged ingredient + store across the brand's recipes (one line per ingredient item and unit)
CREATE OR REPLACE FUNCTION public.brand_price_outliers(_brand_id uuid)
RETURNS TABLE (template_id uuid, ingredient_name text, unit_label text, store text, store_unit_price numeric,
  median_unit_price numeric, problem text, recipes text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; loc record; line jsonb; ex record; f numeric; arr jsonb; med numeric; e jsonb;
BEGIN
  IF NOT public._rc_caller_can_read_brand(_brand_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT bi.vendor_item_id AS tpl, (public._rc_expand(1, min(bi.unit))).u AS u, min(bi.unit) AS unit,
           coalesce(min(t.common_name), min(t.product_name), 'ingredient') AS nm,
           array_agg(DISTINCT bp.name ORDER BY bp.name) AS recs
    FROM public.recipe_blueprint_ingredients bi
    JOIN public.recipe_blueprints bp ON bp.id = bi.blueprint_id AND bp.brand_id = _brand_id AND bp.location_id IS NULL AND coalesce(bp.is_active, true)
    LEFT JOIN public.brand_inventory_templates t ON t.id = bi.vendor_item_id
    WHERE bi.vendor_item_id IS NOT NULL
    GROUP BY bi.vendor_item_id, public._rc_unit_key(bi.unit)
  LOOP
    ex := public._rc_expand(1, r.unit);
    f := CASE WHEN ex.u IN ('g','kg','oz','lb') AND public._rc_oz(ex.u) IS NOT NULL THEN 16.0 / (ex.q * public._rc_oz(ex.u)) ELSE 1.0 / nullif(ex.q,0) END;
    arr := '[]'::jsonb;
    FOR loc IN SELECT l.id, l.name FROM public.locations l WHERE l.brand_id = _brand_id AND l.is_active LOOP
      line := public._rc_item_line(r.tpl, loc.id, 1, r.unit);
      IF coalesce((line->>'missing')::boolean, false) THEN CONTINUE; END IF;
      IF line ? 'problem' THEN arr := arr || jsonb_build_object('store', loc.name, 'problem', line->>'problem');
      ELSE arr := arr || jsonb_build_object('store', loc.name, 'p', (line->>'cost')::numeric * f); END IF;
    END LOOP;
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (x->>'p')::numeric) INTO med FROM jsonb_array_elements(arr) x WHERE x ? 'p';
    FOR e IN SELECT x FROM jsonb_array_elements(arr) x LOOP
      IF e ? 'problem' OR (med > 0 AND abs((e->>'p')::numeric / med - 1) > 0.5) THEN
        template_id := r.tpl; ingredient_name := r.nm; unit_label := public._rc_unit_label(ex.u); store := e->>'store';
        store_unit_price := round((e->>'p')::numeric, 4); median_unit_price := round(med, 4); problem := e->>'problem'; recipes := r.recs;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.brand_recipe_pricing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_recipe_pricing(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_price_outliers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_price_outliers(uuid) TO authenticated, service_role;