
-- Allow employees to update the status of their own document requests (e.g., from 'pending' to 'uploaded')
CREATE POLICY "Employees can update own i9 request status"
ON public.i9_document_requests
FOR UPDATE
USING (auth.uid() = employee_id)
WITH CHECK (auth.uid() = employee_id);
