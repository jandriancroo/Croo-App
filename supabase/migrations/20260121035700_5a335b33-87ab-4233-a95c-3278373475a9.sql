-- Update the can_manage_org_applications function to include 'manager' role
CREATE OR REPLACE FUNCTION public.can_manage_org_applications(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- Super admin can manage all
    is_super_admin(_user_id)
    -- Org admin can manage
    OR is_org_admin(_user_id, _organization_id)
    -- User with admin or manager role who has access to any location in this organization
    OR EXISTS (
      SELECT 1 
      FROM public.user_roles ur
      JOIN public.user_locations ul ON ul.user_id = ur.user_id
      JOIN public.locations l ON l.id = ul.location_id
      WHERE ur.user_id = _user_id 
        AND ur.role IN ('admin', 'org_admin', 'super_admin', 'manager', 'general_manager')
        AND l.organization_id = _organization_id
    )
$$;