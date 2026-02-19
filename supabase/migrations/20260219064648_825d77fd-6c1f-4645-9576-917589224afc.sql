-- Add DELETE policy for inventory_counts (managers+ at the location)
CREATE POLICY "Users can delete inventory counts at their location"
ON public.inventory_counts
FOR DELETE
USING (has_location_access(auth.uid(), location_id));

-- Add DELETE policy for inventory_count_items
CREATE POLICY "Users can delete inventory count items at their location"
ON public.inventory_count_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_counts ic
    WHERE ic.id = inventory_count_items.count_id
      AND has_location_access(auth.uid(), ic.location_id)
  )
);

-- Add DELETE policy for inventory_count_edits
CREATE POLICY "Users can delete inventory count edits at their location"
ON public.inventory_count_edits
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_count_items ici
    JOIN public.inventory_counts ic ON ic.id = ici.count_id
    WHERE ici.id = inventory_count_edits.count_item_id
      AND has_location_access(auth.uid(), ic.location_id)
  )
);