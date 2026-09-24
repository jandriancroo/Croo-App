ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS interview_modality text,
  ADD COLUMN IF NOT EXISTS interview_meeting_url text;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_interview_modality_check
    CHECK (interview_modality IS NULL OR interview_modality IN ('in_person','virtual','phone')),
  ADD CONSTRAINT job_applications_interview_meeting_url_check
    CHECK (interview_meeting_url IS NULL OR interview_meeting_url ~* '^https://');