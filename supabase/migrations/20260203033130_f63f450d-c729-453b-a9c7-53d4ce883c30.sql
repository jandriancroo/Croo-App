
-- Drop the restrictive policy and recreate with shift_manager included
DROP POLICY IF EXISTS "Users can view punches at their locations" ON public.time_punches;

-- Recreate policy including shift_manager role
CREATE POLICY "Users can view punches at their locations"
ON public.time_punches
FOR SELECT
USING (
  has_location_access(auth.uid(), location_id) 
  AND (
    auth.uid() = user_id 
    OR is_super_admin(auth.uid()) 
    OR has_role(auth.uid(), 'admin'::app_role) 
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'shift_manager'::app_role)
    OR has_role(auth.uid(), 'general_manager'::app_role)
  )
);
