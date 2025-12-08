-- Fix PUBLIC_DATA_EXPOSURE: checklist_responses table publicly readable
-- Drop the overly permissive SELECT policy
DROP POLICY IF EXISTS "Users can view responses for submissions" ON checklist_responses;

-- Create a proper location-scoped SELECT policy for authenticated users only
CREATE POLICY "Users can view responses at their location"
ON checklist_responses FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions cs
    WHERE cs.id = checklist_responses.submission_id
    AND has_location_access(auth.uid(), cs.location_id)
  )
);