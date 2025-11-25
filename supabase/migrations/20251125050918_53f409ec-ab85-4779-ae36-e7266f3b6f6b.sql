-- Allow admins to delete checklists
CREATE POLICY "Only admins can delete checklists"
ON public.checklists
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));