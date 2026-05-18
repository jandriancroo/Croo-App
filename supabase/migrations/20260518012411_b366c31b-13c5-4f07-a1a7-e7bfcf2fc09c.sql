CREATE OR REPLACE FUNCTION public.get_pin_migration_health()
 RETURNS TABLE(id uuid, full_name text, pin_pending text, pin_pending_plaintext text, pin_pending_set_at timestamp with time zone, location_ids uuid[], location_names text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'super_admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.pin_pending,
    p.pin_pending_plaintext,
    p.pin_pending_set_at,
    COALESCE(ARRAY_AGG(l.id) FILTER (WHERE l.id IS NOT NULL), ARRAY[]::UUID[]) AS location_ids,
    COALESCE(ARRAY_AGG(l.name ORDER BY l.name) FILTER (WHERE l.name IS NOT NULL), ARRAY[]::TEXT[]) AS location_names
  FROM public.profiles p
  LEFT JOIN public.user_locations ul ON ul.user_id = p.id
  LEFT JOIN public.locations l ON l.id = ul.location_id
  WHERE COALESCE(p.is_active, true) = true
  GROUP BY p.id, p.full_name, p.pin_pending, p.pin_pending_plaintext, p.pin_pending_set_at
  ORDER BY p.full_name NULLS LAST;
END;
$function$;