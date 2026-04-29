DROP FUNCTION IF EXISTS public.get_active_conversion(uuid);
DROP TABLE IF EXISTS public.item_conversions;

CREATE TABLE public.item_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_template_id uuid NOT NULL REFERENCES public.brand_inventory_templates(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  outer_qty numeric NOT NULL,
  outer_unit text NOT NULL,
  has_inner boolean NOT NULL DEFAULT false,
  inner_qty numeric,
  inner_unit text,
  canonical_unit text NOT NULL,
  canonical_qty_per_inner numeric NOT NULL,
  source text NOT NULL DEFAULT 'vendor_auto',
  version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX item_conversions_template_id_idx ON public.item_conversions(brand_template_id);
CREATE INDEX item_conversions_brand_id_idx ON public.item_conversions(brand_id);
CREATE INDEX item_conversions_active_idx ON public.item_conversions(brand_template_id) WHERE effective_to IS NULL;

ALTER TABLE public.item_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members can view conversions"
ON public.item_conversions FOR SELECT
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = item_conversions.brand_id AND bm.user_id = auth.uid())
);

CREATE POLICY "Brand members can insert conversions"
ON public.item_conversions FOR INSERT
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = item_conversions.brand_id AND bm.user_id = auth.uid())
);

CREATE POLICY "Brand members can update conversions"
ON public.item_conversions FOR UPDATE
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = item_conversions.brand_id AND bm.user_id = auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = item_conversions.brand_id AND bm.user_id = auth.uid())
);

CREATE POLICY "Brand members can delete conversions"
ON public.item_conversions FOR DELETE
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = item_conversions.brand_id AND bm.user_id = auth.uid())
);

CREATE TRIGGER update_item_conversions_updated_at
BEFORE UPDATE ON public.item_conversions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

WITH template_picks AS (
  SELECT DISTINCT ON (bit.id)
    bit.id AS brand_template_id,
    bit.brand_id,
    ii.pack_quantity,
    ii.pack_quantity_override,
    ii.count_unit
  FROM public.brand_inventory_templates bit
  LEFT JOIN public.inventory_items ii
    ON ii.brand_item_id = bit.id
    AND ii.is_active = true
    AND ii.pack_quantity IS NOT NULL
    AND ii.count_unit IS NOT NULL
    AND ii.vendor_source IN ('pfg', 'produce_alliance')
  WHERE COALESCE(bit.status, '') <> 'archived'
  ORDER BY bit.id, ii.pack_quantity_override NULLS LAST, ii.updated_at DESC NULLS LAST
)
INSERT INTO public.item_conversions (
  brand_template_id, brand_id,
  outer_qty, outer_unit,
  has_inner, canonical_unit, canonical_qty_per_inner,
  source
)
SELECT
  tp.brand_template_id,
  tp.brand_id,
  CASE WHEN tp.pack_quantity IS NOT NULL THEN COALESCE(tp.pack_quantity_override, tp.pack_quantity) ELSE 1 END,
  CASE WHEN tp.count_unit IS NOT NULL THEN CASE WHEN lower(tp.count_unit) = 'each' THEN 'ea' ELSE lower(tp.count_unit) END ELSE 'ea' END,
  false,
  CASE WHEN tp.count_unit IS NOT NULL THEN CASE WHEN lower(tp.count_unit) = 'each' THEN 'ea' ELSE lower(tp.count_unit) END ELSE 'ea' END,
  1,
  CASE WHEN tp.pack_quantity IS NOT NULL AND tp.count_unit IS NOT NULL THEN 'vendor_auto' ELSE 'needs_review' END
FROM template_picks tp;

CREATE OR REPLACE FUNCTION public.get_active_conversion(p_template_id uuid)
RETURNS public.item_conversions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.item_conversions
  WHERE brand_template_id = p_template_id
    AND effective_to IS NULL
  ORDER BY effective_from DESC
  LIMIT 1;
$$;