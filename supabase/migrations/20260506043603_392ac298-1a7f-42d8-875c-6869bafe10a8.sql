DROP FUNCTION IF EXISTS public.get_publishable_locations(uuid);
CREATE FUNCTION public.get_publishable_locations(_user_id uuid)
RETURNS TABLE(id uuid, name text, organization_id uuid, brand_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.id, l.name, l.organization_id, o.brand_id
  FROM public.locations l
  LEFT JOIN public.organizations o ON o.id = l.organization_id
  WHERE l.is_active = true
    AND (
      public.is_super_admin(_user_id)
      OR (
        public.has_role_or_higher(_user_id, 'admin')
        AND l.organization_id IN (
          SELECT DISTINCT loc.organization_id
          FROM public.user_locations ul
          JOIN public.locations loc ON loc.id = ul.location_id
          WHERE ul.user_id = _user_id
            AND loc.organization_id IS NOT NULL
        )
      )
    )
  ORDER BY l.name
$function$;