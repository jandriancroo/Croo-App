CREATE OR REPLACE FUNCTION public.get_pin_migration_health()
 RETURNS TABLE(id uuid, full_name text, pin_pending text, pin_pending_plaintext text, pin_pending_set_at timestamp with time zone, location_ids uuid[], location_names text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sandbox_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'super_admin') THEN
    RETURN;
  END IF;

  SELECT l.id INTO sandbox_id FROM public.locations l WHERE l.name = 'Sandbox' LIMIT 1;

  RETURN QUERY
  WITH user_locs AS (
    SELECT
      p.id AS user_id,
      COALESCE(ARRAY_AGG(l.id) FILTER (WHERE l.id IS NOT NULL AND l.id <> sandbox_id), ARRAY[]::UUID[]) AS loc_ids,
      COALESCE(ARRAY_AGG(l.name ORDER BY l.name) FILTER (WHERE l.name IS NOT NULL AND l.id <> sandbox_id), ARRAY[]::TEXT[]) AS loc_names,
      BOOL_OR(l.id IS NOT NULL AND l.id <> sandbox_id) AS has_real_location
    FROM public.profiles p
    LEFT JOIN public.user_locations ul ON ul.user_id = p.id
    LEFT JOIN public.locations l ON l.id = ul.location_id
    WHERE COALESCE(p.is_active, true) = true
    GROUP BY p.id
  )
  SELECT
    p.id,
    p.full_name,
    p.pin_pending,
    p.pin_pending_plaintext,
    p.pin_pending_set_at,
    ul.loc_ids,
    ul.loc_names
  FROM public.profiles p
  JOIN user_locs ul ON ul.user_id = p.id
  WHERE COALESCE(ul.has_real_location, false) = true
  ORDER BY p.full_name NULLS LAST;
END;
$function$;