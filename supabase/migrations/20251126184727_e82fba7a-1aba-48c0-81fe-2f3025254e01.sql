-- Update RLS policies for collaborative checklist completion
-- Allow users to view all submissions (not just their own)
DROP POLICY IF EXISTS "Users can view all submissions" ON checklist_submissions;
CREATE POLICY "Users can view all submissions" 
ON checklist_submissions FOR SELECT 
USING (true);

-- Allow users to create submissions (any user can create the daily submission)
DROP POLICY IF EXISTS "Users can create submissions" ON checklist_submissions;
CREATE POLICY "Users can create submissions" 
ON checklist_submissions FOR INSERT 
WITH CHECK (auth.uid() = submitted_by);

-- Allow users to update any submission (for notes field)
DROP POLICY IF EXISTS "Users can update submissions" ON checklist_submissions;
CREATE POLICY "Users can update submissions" 
ON checklist_submissions FOR UPDATE 
USING (true);

-- Allow users to view all responses
DROP POLICY IF EXISTS "Users can view responses for submissions" ON checklist_responses;
CREATE POLICY "Users can view responses for submissions" 
ON checklist_responses FOR SELECT 
USING (true);

-- Allow users to create responses on any submission
DROP POLICY IF EXISTS "Users can create responses" ON checklist_responses;
CREATE POLICY "Users can create responses" 
ON checklist_responses FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM checklist_submissions 
    WHERE checklist_submissions.id = checklist_responses.submission_id
  )
);

-- Allow users to update any response
DROP POLICY IF EXISTS "Users can update responses for submissions" ON checklist_responses;
CREATE POLICY "Users can update responses for submissions" 
ON checklist_responses FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions 
    WHERE checklist_submissions.id = checklist_responses.submission_id
  )
);

-- Allow users to delete responses (for undo functionality)
DROP POLICY IF EXISTS "Users can delete responses for submissions" ON checklist_responses;
CREATE POLICY "Users can delete responses for submissions" 
ON checklist_responses FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions 
    WHERE checklist_submissions.id = checklist_responses.submission_id
  )
);