-- Drop the existing insert policy
DROP POLICY IF EXISTS "Users can create own certifications" ON public.certifications;

-- Create new insert policy for users creating their own certifications
CREATE POLICY "Users can create own certifications" 
ON public.certifications 
FOR INSERT 
WITH CHECK ((auth.uid() = user_id) AND (status = 'pending'::text));

-- Create insert policy for admins to upload certifications for anyone
CREATE POLICY "Admins can create certifications for any user" 
ON public.certifications 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));