-- Employees need SELECT on their own i9_documents for INSERT to work properly
CREATE POLICY "Employees can view own i9 documents"
ON public.i9_documents
FOR SELECT
TO authenticated
USING (auth.uid() = employee_id);