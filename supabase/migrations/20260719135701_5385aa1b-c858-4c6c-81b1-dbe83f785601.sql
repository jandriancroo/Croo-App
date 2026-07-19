
CREATE OR REPLACE FUNCTION public.profile_at_punch_device_location(_profile_id uuid, _device_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_locations ul
    JOIN public.punch_clock_devices d ON d.location_id = ul.location_id
    WHERE ul.user_id = _profile_id
      AND d.auth_user_id = _device_user_id
      AND d.revoked_at IS NULL
  );
$$;

DROP POLICY IF EXISTS "Punch device can read profiles at its location" ON public.profiles;

CREATE POLICY "Punch device can read profiles at its location"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND (SELECT public.profile_at_punch_device_location(profiles.id, auth.uid()))
);
