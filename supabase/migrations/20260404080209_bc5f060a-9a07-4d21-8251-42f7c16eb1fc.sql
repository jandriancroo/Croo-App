
DROP POLICY "Brand members can manage categories" ON public.brand_inventory_categories;

CREATE POLICY "Brand members can manage categories"
ON public.brand_inventory_categories
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM brand_members bm
    WHERE bm.brand_id = brand_inventory_categories.brand_id
      AND bm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM brand_members bm
    WHERE bm.brand_id = brand_inventory_categories.brand_id
      AND bm.user_id = auth.uid()
  )
);
