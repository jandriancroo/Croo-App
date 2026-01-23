-- Create enum for flag colors
CREATE TYPE public.applicant_flag_color AS ENUM ('none', 'green', 'yellow', 'red');

-- Create table for applicant flags with history tracking
CREATE TABLE public.applicant_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  flag_color applicant_flag_color NOT NULL DEFAULT 'none',
  reason TEXT,
  set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_applicant_flags_application_id ON public.applicant_flags(application_id);
CREATE INDEX idx_applicant_flags_created_at ON public.applicant_flags(created_at DESC);

-- Enable RLS
ALTER TABLE public.applicant_flags ENABLE ROW LEVEL SECURITY;

-- Create policies - employees with access to the location can view/manage flags
CREATE POLICY "Users can view applicant flags for their organization"
ON public.applicant_flags
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.job_applications ja
    JOIN public.locations l ON ja.location_id = l.id
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE ja.id = applicant_flags.application_id
    AND (
      p.default_location_id = l.id 
      OR p.all_locations_enabled = true
      OR EXISTS (
        SELECT 1 FROM public.user_locations ul 
        WHERE ul.user_id = auth.uid() 
        AND ul.location_id = l.id
      )
    )
  )
);

CREATE POLICY "Users can create applicant flags for their organization"
ON public.applicant_flags
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.job_applications ja
    JOIN public.locations l ON ja.location_id = l.id
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE ja.id = applicant_flags.application_id
    AND (
      p.default_location_id = l.id 
      OR p.all_locations_enabled = true
      OR EXISTS (
        SELECT 1 FROM public.user_locations ul 
        WHERE ul.user_id = auth.uid() 
        AND ul.location_id = l.id
      )
    )
  )
);

-- Add a view to get the latest flag for each application (for easy querying)
CREATE OR REPLACE VIEW public.applicant_current_flags AS
SELECT DISTINCT ON (application_id)
  application_id,
  flag_color,
  reason,
  set_by,
  created_at
FROM public.applicant_flags
ORDER BY application_id, created_at DESC;