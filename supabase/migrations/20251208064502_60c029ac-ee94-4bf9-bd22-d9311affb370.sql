-- Fix MISSING_RLS_PROTECTION: employee_notes visible across locations
-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Admins and managers can view employee notes" ON employee_notes;

-- Create a location-scoped SELECT policy
-- Managers can only view notes about employees at locations they have access to
CREATE POLICY "Admins and managers can view employee notes at their locations"
ON employee_notes FOR SELECT TO authenticated
USING (
  (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  AND EXISTS (
    SELECT 1 FROM user_locations ul
    WHERE ul.user_id = employee_notes.user_id
    AND has_location_access(auth.uid(), ul.location_id)
  )
);