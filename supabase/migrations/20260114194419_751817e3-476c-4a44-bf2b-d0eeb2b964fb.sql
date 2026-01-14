-- Allow team members to see user_locations for users at the same location(s) as them
-- This enables the messaging "New Chat" dialog to show teammates
CREATE POLICY "Team members can view user locations at their own locations"
ON public.user_locations
FOR SELECT
TO authenticated
USING (
  location_id IN (
    SELECT ul.location_id 
    FROM public.user_locations ul 
    WHERE ul.user_id = auth.uid()
  )
);