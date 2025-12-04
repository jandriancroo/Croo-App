-- Update has_location_access to also check organization membership
CREATE OR REPLACE FUNCTION public.has_location_access(_user_id uuid, _location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    is_super_admin(_user_id) 
    OR EXISTS (
      SELECT 1 FROM public.user_locations
      WHERE user_id = _user_id AND location_id = _location_id
    )
    OR EXISTS (
      -- Check if user is org admin for the location's organization
      SELECT 1 
      FROM public.locations l
      JOIN public.organization_members om ON om.organization_id = l.organization_id
      WHERE l.id = _location_id 
        AND om.user_id = _user_id 
        AND om.org_role = 'admin'
    )
$$;