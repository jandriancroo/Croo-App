-- Drop the overly permissive policy
DROP POLICY "All users can view basic profile info" ON public.profiles;

-- Replace with location-scoped coworker visibility
-- Users can see profiles of people at the same location(s)
CREATE POLICY "Users can view coworker profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_locations ul1
      JOIN public.user_locations ul2 ON ul1.location_id = ul2.location_id
      WHERE ul1.user_id = auth.uid()
      AND ul2.user_id = profiles.id
    )
  );