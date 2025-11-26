-- Add completed_by column to track who completed each item
ALTER TABLE checklist_responses 
ADD COLUMN completed_by uuid REFERENCES auth.users(id);

-- Add RLS policy to allow users to update responses
CREATE POLICY "Users can update responses for submissions"
ON checklist_responses
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions
    WHERE checklist_submissions.id = checklist_responses.submission_id
  )
);

-- Update delete policy to allow any authenticated user to delete responses
DROP POLICY IF EXISTS "Users can delete responses for own submissions" ON checklist_responses;

CREATE POLICY "Users can delete responses for submissions"
ON checklist_responses
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions
    WHERE checklist_submissions.id = checklist_responses.submission_id
  )
);