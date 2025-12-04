-- Drop existing SELECT policies on certifications
DROP POLICY IF EXISTS "Admins can view all certifications" ON public.certifications;
DROP POLICY IF EXISTS "Users can view own certifications" ON public.certifications;

-- Recreate with super_admin support
CREATE POLICY "Admins can view all certifications" 
ON public.certifications 
FOR SELECT 
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own certifications" 
ON public.certifications 
FOR SELECT 
USING (auth.uid() = user_id);

-- Also update INSERT, UPDATE, DELETE policies
DROP POLICY IF EXISTS "Admins can create certifications for any user" ON public.certifications;
DROP POLICY IF EXISTS "Admins can update certifications" ON public.certifications;
DROP POLICY IF EXISTS "Admins can delete certifications" ON public.certifications;

CREATE POLICY "Admins can create certifications for any user" 
ON public.certifications 
FOR INSERT 
WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update certifications" 
ON public.certifications 
FOR UPDATE 
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete certifications" 
ON public.certifications 
FOR DELETE 
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));