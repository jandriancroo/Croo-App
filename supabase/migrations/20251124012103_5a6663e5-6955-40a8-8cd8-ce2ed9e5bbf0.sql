-- Allow users to delete their own submissions
CREATE POLICY "Users can delete own submissions"
ON public.checklist_submissions
FOR DELETE
USING (auth.uid() = submitted_by);

-- Allow cascading delete for responses when submission is deleted
CREATE POLICY "Users can delete responses for own submissions"
ON public.checklist_responses
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM checklist_submissions
    WHERE checklist_submissions.id = checklist_responses.submission_id
    AND checklist_submissions.submitted_by = auth.uid()
  )
);