-- Allow public/anonymous read access to active organizations for the job application form
CREATE POLICY "Public can view active organizations"
ON public.organizations
FOR SELECT
USING (is_active = true);