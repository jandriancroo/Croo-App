-- Tolerate employees with no location assignment yet, so no one is locked out.
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
    AND (
      _location_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.user_id = p.id AND ul.location_id = _location_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.user_locations ul2 WHERE ul2.user_id = p.id
      )
    )
  LIMIT 1;
$$;

-- Kiosk runs unauthenticated. Strip its column access down to the display-only
-- fields the punch clock UI actually renders.
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, full_name, profile_photo_url, is_active, birthday, display_order)
  ON public.profiles TO anon;