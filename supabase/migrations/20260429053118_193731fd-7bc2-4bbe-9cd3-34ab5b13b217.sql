-- Part 1: Create item_conversions table
CREATE TABLE public.item_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,

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

CREATE INDEX item_conversions_item_id_idx ON public.item_conversions(item_id);
CREATE INDEX item_conversions_active_idx ON public.item_conversions(item_id) WHERE effective_to IS NULL;
CREATE INDEX item_conversions_brand_id_idx ON public.item_conversions(brand_id);

CREATE TRIGGER update_item_conversions_updated_at
  BEFORE UPDATE ON public.item_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.item_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members can view item conversions"
ON public.item_conversions
FOR SELECT
TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = item_conversions.brand_id
      AND bm.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "Brand members can insert item conversions"
ON public.item_conversions
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = item_conversions.brand_id
      AND bm.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "Brand members can update item conversions"
ON public.item_conversions
FOR UPDATE
TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = item_conversions.brand_id
      AND bm.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = item_conversions.brand_id
      AND bm.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "Brand members can delete item conversions"
ON public.item_conversions
FOR DELETE
TO authenticated
USING (
  public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = item_conversions.brand_id
      AND bm.user_id = (SELECT auth.uid())
  )
);

-- Part 2: Auto-populate from existing vendor data
-- Brand is derived: inventory_items.location_id -> locations.organization_id -> organizations.brand_id

-- 2a) vendor_auto rows
INSERT INTO public.item_conversions (
  item_id, brand_id, outer_qty, outer_unit,
  has_inner, canonical_unit, canonical_qty_per_inner, source
)
SELECT
  ii.id,
  o.brand_id,
  COALESCE(ii.pack_quantity_override, ii.pack_quantity)::numeric,
  CASE WHEN lower(ii.count_unit) = 'each' THEN 'ea' ELSE lower(ii.count_unit) END,
  false,
  CASE WHEN lower(ii.count_unit) = 'each' THEN 'ea' ELSE lower(ii.count_unit) END,
  1,
  'vendor_auto'
FROM public.inventory_items ii
LEFT JOIN public.locations l ON l.id = ii.location_id
LEFT JOIN public.organizations o ON o.id = l.organization_id
WHERE ii.is_active = true
  AND ii.vendor_source IN ('pfg', 'produce_alliance')
  AND ii.pack_quantity IS NOT NULL
  AND ii.count_unit IS NOT NULL;

-- 2b) needs_review placeholders
INSERT INTO public.item_conversions (
  item_id, brand_id, outer_qty, outer_unit,
  has_inner, canonical_unit, canonical_qty_per_inner, source
)
SELECT
  ii.id,
  o.brand_id,
  1,
  'ea',
  false,
  'ea',
  1,
  'needs_review'
FROM public.inventory_items ii
LEFT JOIN public.locations l ON l.id = ii.location_id
LEFT JOIN public.organizations o ON o.id = l.organization_id
WHERE ii.is_active = true
  AND ii.vendor_source IN ('pfg', 'produce_alliance')
  AND (ii.pack_quantity IS NULL OR ii.count_unit IS NULL);

-- Part 3: Helper function
CREATE OR REPLACE FUNCTION public.get_active_conversion(p_item_id uuid)
RETURNS public.item_conversions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.item_conversions
  WHERE item_id = p_item_id
    AND effective_to IS NULL
  ORDER BY effective_from DESC
  LIMIT 1;
$$;