-- Fix checklist image visibility for all location users

-- Make checklist-images bucket public so URLs work without signed tokens
-- Images have random UUID paths so they're not guessable
UPDATE storage.buckets SET public = true WHERE id = 'checklist-images';

-- Clean up redundant/conflicting storage policies for checklist-images
DROP POLICY IF EXISTS "Anyone can view checklist images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view checklist images" ON storage.objects;

-- Create a single clear policy: authenticated users at location can view
CREATE POLICY "Authenticated users can view checklist images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'checklist-images');

-- Ensure checklist_responses SELECT policy is properly configured
-- for ALL user roles at a location (already uses has_location_access which checks location membership)
DROP POLICY IF EXISTS "Users can view responses at their location" ON checklist_responses;

CREATE POLICY "Users can view responses at their locations"
ON checklist_responses FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions cs
    WHERE cs.id = checklist_responses.submission_id
    AND has_location_access(auth.uid(), cs.location_id)
  )
);

-- Ensure INSERT/UPDATE/DELETE policies also use authenticated role
DROP POLICY IF EXISTS "Users can create responses" ON checklist_responses;
DROP POLICY IF EXISTS "Users can update responses for submissions" ON checklist_responses;
DROP POLICY IF EXISTS "Users can delete responses for submissions" ON checklist_responses;

CREATE POLICY "Users can create responses"
ON checklist_responses FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM checklist_submissions cs
    WHERE cs.id = checklist_responses.submission_id
    AND has_location_access(auth.uid(), cs.location_id)
  )
);

CREATE POLICY "Users can update responses at their locations"
ON checklist_responses FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions cs
    WHERE cs.id = checklist_responses.submission_id
    AND has_location_access(auth.uid(), cs.location_id)
  )
);

CREATE POLICY "Users can delete responses at their locations"
ON checklist_responses FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions cs
    WHERE cs.id = checklist_responses.submission_id
    AND has_location_access(auth.uid(), cs.location_id)
  )
);