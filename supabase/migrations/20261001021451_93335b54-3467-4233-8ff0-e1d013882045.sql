CREATE TABLE public.location_pack_lens_pins (
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_template_id uuid NOT NULL,
  pack_config_id uuid NOT NULL REFERENCES public.brand_pack_configs(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'kept_today',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, brand_template_id)
);
GRANT SELECT ON public.location_pack_lens_pins TO authenticated;
GRANT ALL ON public.location_pack_lens_pins TO service_role;
ALTER TABLE public.location_pack_lens_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Store staff can read pack pins" ON public.location_pack_lens_pins
  FOR SELECT TO authenticated USING (public.has_location_access(auth.uid(), location_id));

CREATE OR REPLACE VIEW public.v_store_pack_lens AS
WITH items AS (
  SELECT i.location_id, i.brand_item_id AS tid, i.item_number
  FROM public.inventory_items i JOIN public.locations l ON l.id = i.location_id
  WHERE i.is_active AND i.brand_item_id IS NOT NULL AND l.lens_enabled
),
nums AS (
  SELECT location_id, tid, item_number AS num FROM items WHERE item_number IS NOT NULL
  UNION
  SELECT it.location_id, it.tid, m.vendor_item_id FROM items it
  JOIN public.brand_vendor_mappings m ON m.brand_template_id = it.tid AND m.source_location_id = it.location_id
  WHERE m.vendor_item_id IS NOT NULL
),
cfg AS (
  SELECT c.*, count(*) OVER (PARTITION BY c.brand_template_id) AS n
  FROM public.brand_pack_configs c WHERE c.status = 'approved' AND c.count_units_per_case > 0
),
ranked AS (
  SELECT DISTINCT it.location_id, c.id, c.brand_template_id, c.count_units_per_case, c.cost_per_common_unit, c.common_unit,
    c.outer_qty, c.outer_type, c.inner_qty, c.inner_type, c.show_cases, c.show_inner_packs, c.show_common_unit,
    CASE WHEN c.n = 1 THEN 0
         WHEN EXISTS (SELECT 1 FROM nums x WHERE x.location_id = it.location_id AND x.tid = it.tid AND x.num = c.source_evidence->>'sku') THEN 1
         WHEN EXISTS (SELECT 1 FROM public.location_pack_lens_pins p WHERE p.location_id = it.location_id AND p.brand_template_id = it.tid AND p.pack_config_id = c.id) THEN 2
         ELSE 3 END AS rnk
  FROM items it JOIN cfg c ON c.brand_template_id = it.tid
)
SELECT DISTINCT ON (location_id, brand_template_id)
  location_id, brand_template_id, id AS pack_config_id, count_units_per_case, cost_per_common_unit, common_unit,
  outer_qty, outer_type, inner_qty, inner_type, show_cases, show_inner_packs, show_common_unit,
  CASE rnk WHEN 0 THEN 'single' WHEN 1 THEN 'sku_match' ELSE 'kept_today' END AS match_reason,
  (rnk >= 2) AS needs_review
FROM ranked
ORDER BY location_id, brand_template_id, rnk, id;

REVOKE ALL ON public.v_store_pack_lens FROM anon, authenticated;
GRANT SELECT ON public.v_store_pack_lens TO service_role;

CREATE OR REPLACE FUNCTION public.get_store_pack_lens(_location_id uuid)
RETURNS TABLE (brand_template_id uuid, pack_config_id uuid, count_units_per_case numeric, cost_per_common_unit numeric,
  common_unit text, outer_qty integer, outer_type text, inner_qty numeric, inner_type text,
  show_cases boolean, show_inner_packs boolean, show_common_unit boolean, match_reason text, needs_review boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.brand_template_id, v.pack_config_id, v.count_units_per_case, v.cost_per_common_unit, v.common_unit,
    v.outer_qty, v.outer_type, v.inner_qty, v.inner_type, v.show_cases, v.show_inner_packs, v.show_common_unit,
    v.match_reason, v.needs_review
  FROM public.v_store_pack_lens v
  WHERE v.location_id = _location_id
    AND public.has_location_access(auth.uid(), _location_id);
$$;
REVOKE ALL ON FUNCTION public.get_store_pack_lens(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_pack_lens(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.strip_recipe_pack_multipliers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_recipe THEN
    NEW.pack_quantity := NULL;
    NEW.pack_quantity_override := NULL;
    NEW.count_units_per_case := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_strip_recipe_pack_multipliers ON public.inventory_items;
CREATE TRIGGER trg_strip_recipe_pack_multipliers
  BEFORE INSERT OR UPDATE OF pack_quantity, pack_quantity_override, count_units_per_case, is_recipe ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.strip_recipe_pack_multipliers();