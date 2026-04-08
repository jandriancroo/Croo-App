
DROP POLICY IF EXISTS "Users can manage product groups for their locations" ON public.inventory_product_groups;
DROP POLICY IF EXISTS "Users can view product groups for their locations" ON public.inventory_product_groups;

CREATE POLICY "Users can view product groups"
ON public.inventory_product_groups
FOR SELECT
USING (
  (location_id IN (SELECT ul.location_id FROM user_locations ul WHERE ul.user_id = auth.uid()))
  OR
  (brand_id IN (SELECT bm.brand_id FROM brand_members bm WHERE bm.user_id = auth.uid()))
);

CREATE POLICY "Users can manage product groups"
ON public.inventory_product_groups
FOR ALL
USING (
  (location_id IN (SELECT ul.location_id FROM user_locations ul WHERE ul.user_id = auth.uid()))
  OR
  (brand_id IN (SELECT bm.brand_id FROM brand_members bm WHERE bm.user_id = auth.uid()))
);
