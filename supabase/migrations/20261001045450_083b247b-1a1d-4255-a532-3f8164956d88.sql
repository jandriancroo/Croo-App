CREATE OR REPLACE FUNCTION public._rc_batch_lens(_bp_id uuid, _location_id uuid, _visited uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; total numeric := 0; missing text[] := '{}'; unpriced text[] := '{}'; lens_used text[] := '{}';
  ex record; price numeric; divisor numeric; nm text; sub jsonb; sub_id uuid; sb record; yk text; qy numeric; lk text; lbl text;
BEGIN
  IF _bp_id = ANY(_visited) THEN
    RETURN jsonb_build_object('cost', 0, 'complete', false, 'missing', jsonb_build_array('recipe loop'), 'unpriced', '[]'::jsonb, 'lens', '[]'::jsonb);
  END IF;
  FOR r IN
    SELECT bi.*, coalesce(bi.source_name, t.common_name, t.product_name, 'ingredient') AS ing_name,
           si.id AS si_id, si.name AS si_name, si.cost_per_unit, si.blended_price, si.linked_item_id,
           si.pack_quantity, si.pack_size,
           c.outer_qty, c.canonical_qty_per_inner, c.canonical_unit,
           v.count_units_per_case AS l_units, v.common_unit AS l_unit, v.outer_qty AS l_outer, v.outer_type AS l_outer_type
    FROM public.recipe_blueprint_ingredients bi
    LEFT JOIN public.brand_inventory_templates t ON t.id = bi.vendor_item_id
    LEFT JOIN LATERAL (SELECT * FROM public.inventory_items i
       WHERE i.location_id = _location_id AND i.brand_item_id = bi.vendor_item_id AND i.is_active
       ORDER BY i.updated_at DESC LIMIT 1) si ON bi.vendor_item_id IS NOT NULL
    LEFT JOIN LATERAL (SELECT * FROM public.item_conversions ic
       WHERE ic.brand_template_id = bi.vendor_item_id AND ic.effective_to IS NULL
       ORDER BY ic.version DESC LIMIT 1) c ON bi.vendor_item_id IS NOT NULL
    LEFT JOIN LATERAL (SELECT * FROM public.v_store_pack_lens vl
       WHERE vl.location_id = _location_id AND vl.brand_template_id = bi.vendor_item_id
         AND coalesce(vl.count_units_per_case,0) > 0 LIMIT 1) v ON bi.vendor_item_id IS NOT NULL
    WHERE bi.blueprint_id = _bp_id
  LOOP
    ex := public._rc_expand(coalesce(r.quantity,0), r.unit);

    IF r.ingredient_type = 'blueprint' OR r.sub_blueprint_id IS NOT NULL THEN
      IF r.sub_blueprint_id IS NULL THEN missing := missing || r.ing_name; CONTINUE; END IF;
      sub_id := public._rc_brand_bp(r.sub_blueprint_id);
      SELECT name, yield_qty, yield_unit INTO sb FROM public.recipe_blueprints WHERE id = sub_id;
      IF NOT FOUND THEN missing := missing || r.ing_name; CONTINUE; END IF;
      sub := public._rc_batch_lens(sub_id, _location_id, _visited || _bp_id);
      missing := missing || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'missing'));
      unpriced := unpriced || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'unpriced'));
      lens_used := lens_used || ARRAY(SELECT sb.name || ' > ' || jsonb_array_elements_text(sub->'lens'));
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
      total := total + price * ex.q; CONTINUE;
    END IF;

    IF r.l_units IS NOT NULL THEN
      lk := public._rc_unit_key(r.l_unit);
      IF ex.u IN ('ea','cn') AND lk IN ('ea','cn') THEN
        divisor := r.l_units; lbl := trim(to_char(r.l_units,'FM999990.####')) || ' ' || r.l_unit || '/case';
      ELSIF ex.u IN ('ea','cn') AND coalesce(r.l_outer,0) > 0 THEN
        -- recipe counts containers (cans, bags); store pack says how many per case
        divisor := r.l_outer; lbl := r.l_outer || ' ' || coalesce(r.l_outer_type,'units') || '/case';
      ELSIF public._rc_oz(ex.u) IS NOT NULL AND public._rc_oz(lk) IS NOT NULL THEN
        divisor := r.l_units * public._rc_oz(lk); lbl := trim(to_char(r.l_units,'FM999990.####')) || ' ' || r.l_unit || '/case';
      ELSE
        unpriced := unpriced || (nm || ' (recipe unit ' || coalesce(r.unit,'?') || ' vs store pack unit ' || coalesce(r.l_unit,'?') || ')');
        CONTINUE;
      END IF;
      lens_used := lens_used || (nm || ': ' || lbl);
      IF ex.u IN ('ea','cn') THEN total := total + price / divisor * ex.q;
      ELSE total := total + price / divisor * ex.q * public._rc_oz(ex.u); END IF;
      CONTINUE;
    END IF;

    IF ex.u IN ('ea','cn') THEN
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
    'missing', to_jsonb(missing), 'unpriced', to_jsonb(unpriced), 'lens', to_jsonb(lens_used));
END $$;
REVOKE ALL ON FUNCTION public._rc_batch_lens(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rc_batch_lens(uuid, uuid, uuid[]) TO service_role;