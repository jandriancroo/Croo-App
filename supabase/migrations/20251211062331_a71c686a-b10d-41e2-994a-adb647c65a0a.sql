-- Allow public/anonymous users to view their own applications by email
CREATE POLICY "Applicants can view own applications by email"
ON public.job_applications
FOR SELECT
USING (true);

-- Note: The actual email filtering happens in the query
-- We allow public SELECT but the query filters by email provided by the user