-- Update delete policy to include manager role
DROP POLICY IF EXISTS "Managers can delete documents" ON public.read_and_sign_documents;

CREATE POLICY "Managers can delete documents" 
ON public.read_and_sign_documents 
FOR DELETE 
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'general_manager'::app_role)
  OR has_role(auth.uid(), 'shift_manager'::app_role)
);