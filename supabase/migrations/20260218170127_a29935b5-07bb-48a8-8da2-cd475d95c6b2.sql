-- Allow public/anon access to organizations for the public job application page
CREATE POLICY "Public can view active organizations for applications"
ON public.organizations
FOR SELECT
USING (is_active = true);