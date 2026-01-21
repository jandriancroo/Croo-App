-- Create a helper function to check if user can manage applications for an organization
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
    -- User with admin role who has access to any location in this organization
    OR EXISTS (
      SELECT 1 
      FROM public.user_roles ur
      JOIN public.user_locations ul ON ul.user_id = ur.user_id
      JOIN public.locations l ON l.id = ul.location_id
      WHERE ur.user_id = _user_id 
        AND ur.role IN ('admin', 'org_admin', 'super_admin')
        AND l.organization_id = _organization_id
    )
$$;

-- Drop the existing policy
DROP POLICY IF EXISTS "Org admins can view and manage applications" ON public.job_applications;

-- Create updated policy that includes location admins
CREATE POLICY "Org admins can view and manage applications" 
ON public.job_applications 
FOR ALL 
USING (
  can_manage_org_applications(auth.uid(), organization_id)
  OR has_location_access(auth.uid(), location_id)
)
WITH CHECK (
  can_manage_org_applications(auth.uid(), organization_id)
  OR has_location_access(auth.uid(), location_id)
);