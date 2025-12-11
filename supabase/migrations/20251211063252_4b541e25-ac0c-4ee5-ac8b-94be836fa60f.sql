-- Add interview scheduling fields to job_applications
ALTER TABLE public.job_applications
ADD COLUMN IF NOT EXISTS interview_date date,
ADD COLUMN IF NOT EXISTS interview_time time without time zone,
ADD COLUMN IF NOT EXISTS interview_status text DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.job_applications.interview_status IS 'pending, accepted, or declined';