
CREATE POLICY "Users with location access can update item locations"
ON public.inventory_item_locations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inventory_items ii
    WHERE ii.id = inventory_item_locations.item_id
    AND has_location_access(auth.uid(), ii.location_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inventory_items ii
    WHERE ii.id = inventory_item_locations.item_id
    AND has_location_access(auth.uid(), ii.location_id)
  )
);
