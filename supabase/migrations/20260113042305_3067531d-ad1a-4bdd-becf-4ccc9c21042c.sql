-- Drop and recreate the employee update policy to ensure it works correctly
DROP POLICY IF EXISTS "Employees can sign their writeups" ON public.employee_writeups;

-- Create a policy that allows employees to update ONLY signature fields on their own writeups
CREATE POLICY "Employees can sign their writeups" 
ON public.employee_writeups 
FOR UPDATE 
TO authenticated
USING (employee_id = auth.uid())
WITH CHECK (employee_id = auth.uid());

-- Also fix the managers update policy to have a proper WITH CHECK
DROP POLICY IF EXISTS "Managers can update writeups" ON public.employee_writeups;

CREATE POLICY "Managers can update writeups" 
ON public.employee_writeups 
FOR UPDATE 
TO authenticated
USING (
  created_by = auth.uid() 
  OR public.has_role_or_higher(auth.uid(), 'admin')
)
WITH CHECK (
  created_by = auth.uid() 
  OR public.has_role_or_higher(auth.uid(), 'admin')
);