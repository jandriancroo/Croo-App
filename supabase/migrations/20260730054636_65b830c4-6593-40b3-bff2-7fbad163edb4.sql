CREATE OR REPLACE FUNCTION public.punch_clock_lookup_pin(_pin text, _location_id uuid)
RETURNS TABLE(id uuid, full_name text, profile_photo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.profile_photo_url
  FROM public.profiles p
  WHERE p.employee_pin = _pin
    AND p.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = p.id
        AND ul.location_id = _location_id
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.punch_clock_lookup_pin(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.punch_clock_lookup_pin(text, uuid) TO anon, authenticated, service_role;