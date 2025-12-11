-- Add AI match columns to job_applications table
ALTER TABLE public.job_applications 
ADD COLUMN IF NOT EXISTS ai_match boolean DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ai_match_reason text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamp with time zone DEFAULT NULL;