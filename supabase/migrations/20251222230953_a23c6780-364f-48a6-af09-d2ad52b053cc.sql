
-- Create function to check if user has a role at or above a certain level
CREATE OR REPLACE FUNCTION public.has_role_or_higher(_user_id uuid, _minimum_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role::text = ANY(
        CASE _minimum_role
          WHEN 'team_member' THEN ARRAY['team_member', 'shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'shift_manager' THEN ARRAY['shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'manager' THEN ARRAY['manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'general_manager' THEN ARRAY['general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'admin' THEN ARRAY['admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'org_admin' THEN ARRAY['org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'fbc' THEN ARRAY['fbc', 'brand_admin', 'super_admin']
          WHEN 'brand_admin' THEN ARRAY['brand_admin', 'super_admin']
          WHEN 'super_admin' THEN ARRAY['super_admin']
          ELSE ARRAY[]::text[]
        END
      )
  )
$$;

-- Drop existing policy  
DROP POLICY IF EXISTS "Users can view sales cache for their locations" ON public.sales_cache;

-- Create new policy that requires shift_manager or higher AND location access
CREATE POLICY "Shift managers can view sales for their locations"
ON public.sales_cache
FOR SELECT
TO authenticated
USING (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);
