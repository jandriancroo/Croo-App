-- Drop the recursive policy that's breaking things
DROP POLICY IF EXISTS "Team members can view user locations at their own locations" ON public.user_locations;

-- Create a security definer function to safely get user's location IDs
CREATE OR REPLACE FUNCTION public.get_user_location_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT location_id 
  FROM public.user_locations 
  WHERE user_id = _user_id
$$;

-- Recreate the policy using the security definer function
CREATE POLICY "Team members can view user locations at their own locations"
ON public.user_locations
FOR SELECT
TO authenticated
USING (
  location_id IN (SELECT public.get_user_location_ids(auth.uid()))
);