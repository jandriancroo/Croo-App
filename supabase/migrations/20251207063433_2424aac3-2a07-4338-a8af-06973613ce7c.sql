-- Drop existing wage_history policies
DROP POLICY IF EXISTS "Admins can delete wage history" ON public.wage_history;
DROP POLICY IF EXISTS "Admins can insert wage history" ON public.wage_history;
DROP POLICY IF EXISTS "Admins can update wage history" ON public.wage_history;
DROP POLICY IF EXISTS "Admins can view all wage history" ON public.wage_history;

-- Create new policies that use has_role function (which handles role hierarchy including super_admin)
CREATE POLICY "Admins can view all wage history" 
ON public.wage_history 
FOR SELECT 
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert wage history" 
ON public.wage_history 
FOR INSERT 
WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update wage history" 
ON public.wage_history 
FOR UPDATE 
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete wage history" 
ON public.wage_history 
FOR DELETE 
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));