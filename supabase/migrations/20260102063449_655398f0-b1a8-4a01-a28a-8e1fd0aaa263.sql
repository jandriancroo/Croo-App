-- Fix RLS for inventory tables to use current location access model

-- Ensure RLS is enabled
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies (used profiles.role / profiles.location_id)
DROP POLICY IF EXISTS "Users can view inventory locations at their location" ON public.inventory_locations;
DROP POLICY IF EXISTS "Managers can manage inventory locations" ON public.inventory_locations;
DROP POLICY IF EXISTS "Users can view inventory items at their location" ON public.inventory_items;
DROP POLICY IF EXISTS "Managers can manage inventory items" ON public.inventory_items;

-- Read access: any user with access to the location
CREATE POLICY "Users can view inventory locations at their locations"
ON public.inventory_locations
FOR SELECT
USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can view inventory items at their locations"
ON public.inventory_items
FOR SELECT
USING (public.has_location_access(auth.uid(), location_id));

-- Write access: managers and above (within their locations)
CREATE POLICY "Managers can manage inventory locations"
ON public.inventory_locations
FOR INSERT
WITH CHECK (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);

CREATE POLICY "Managers can update inventory locations"
ON public.inventory_locations
FOR UPDATE
USING (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
)
WITH CHECK (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);

CREATE POLICY "Managers can delete inventory locations"
ON public.inventory_locations
FOR DELETE
USING (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);

CREATE POLICY "Managers can create inventory items"
ON public.inventory_items
FOR INSERT
WITH CHECK (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);

CREATE POLICY "Managers can update inventory items"
ON public.inventory_items
FOR UPDATE
USING (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
)
WITH CHECK (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);

CREATE POLICY "Managers can delete inventory items"
ON public.inventory_items
FOR DELETE
USING (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);
