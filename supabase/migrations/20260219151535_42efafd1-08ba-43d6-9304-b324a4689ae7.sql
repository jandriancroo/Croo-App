
-- Fix broken RLS policies on inventory_counts
-- The old policies referenced profiles.location_id which doesn't exist

-- DROP old broken policies
DROP POLICY IF EXISTS "Users can create inventory counts" ON public.inventory_counts;
DROP POLICY IF EXISTS "Users can view inventory counts at their location" ON public.inventory_counts;
DROP POLICY IF EXISTS "Users can update their own counts" ON public.inventory_counts;

-- Recreate with proper has_location_access() checks
CREATE POLICY "Users can create inventory counts"
ON public.inventory_counts FOR INSERT
WITH CHECK (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can view inventory counts at their location"
ON public.inventory_counts FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update inventory counts at their location"
ON public.inventory_counts FOR UPDATE
USING (has_location_access(auth.uid(), location_id));

-- Fix broken RLS policies on inventory_count_items
DROP POLICY IF EXISTS "Users can manage count items for their counts" ON public.inventory_count_items;
DROP POLICY IF EXISTS "Users can view count items for counts they can see" ON public.inventory_count_items;

CREATE POLICY "Users can manage count items for their counts"
ON public.inventory_count_items FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM inventory_counts ic
    WHERE ic.id = inventory_count_items.count_id
      AND has_location_access(auth.uid(), ic.location_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inventory_counts ic
    WHERE ic.id = inventory_count_items.count_id
      AND has_location_access(auth.uid(), ic.location_id)
  )
);
