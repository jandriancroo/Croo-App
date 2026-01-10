-- Update is_org_member to also check location-based membership
-- Users are org members if they're in organization_members OR if they're assigned to a location in that org
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Direct organization membership
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _organization_id
  ) OR EXISTS (
    -- Location-based membership: user is assigned to a location in this org
    SELECT 1
    FROM public.user_locations ul
    JOIN public.locations l ON ul.location_id = l.id
    WHERE ul.user_id = _user_id AND l.organization_id = _organization_id
  )
$$;