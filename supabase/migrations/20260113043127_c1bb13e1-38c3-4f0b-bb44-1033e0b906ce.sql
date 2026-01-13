-- Add DELETE policy for managers/admins on employee_writeups
CREATE POLICY "Managers can delete writeups"
ON public.employee_writeups
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_role_or_higher(auth.uid(), 'admin')
);

-- Make logbook-attachments bucket public so signatures can be viewed
UPDATE storage.buckets SET public = true WHERE id = 'logbook-attachments';