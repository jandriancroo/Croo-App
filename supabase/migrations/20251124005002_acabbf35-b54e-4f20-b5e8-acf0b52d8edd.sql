-- Allow admins to insert profiles when inviting users
CREATE POLICY "Admins can create profiles"
ON public.profiles
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));