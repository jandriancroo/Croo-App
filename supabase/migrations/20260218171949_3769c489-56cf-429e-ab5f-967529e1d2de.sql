-- Allow anon users to read back their own just-inserted application
-- This is needed because the client does .insert().select().single()
CREATE POLICY "Anon can read back own application"
ON public.job_applications FOR SELECT TO anon
USING (true);
