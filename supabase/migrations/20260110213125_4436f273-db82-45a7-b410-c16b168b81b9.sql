-- Allow shift managers to view user location assignments at their own locations
-- This fixes the issue where shift managers can't see other team members' shifts
CREATE POLICY "Shift managers can view user locations at their locations"
ON user_locations
FOR SELECT
USING (
  has_role(auth.uid(), 'shift_manager'::app_role) 
  AND has_location_access(auth.uid(), location_id)
);

-- Also allow managers to view (they currently rely on admin policy)
CREATE POLICY "Managers can view user locations at their locations"
ON user_locations
FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND has_location_access(auth.uid(), location_id)
);