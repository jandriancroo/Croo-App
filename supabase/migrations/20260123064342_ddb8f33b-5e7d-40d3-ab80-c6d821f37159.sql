-- Create applicant_notes table (mirrors employee_notes pattern)
CREATE TABLE public.applicant_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.applicant_notes ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX idx_applicant_notes_application_id ON public.applicant_notes(application_id);
CREATE INDEX idx_applicant_notes_created_at ON public.applicant_notes(created_at DESC);

-- RLS: Users who can manage applications can view/create notes
CREATE POLICY "Users can view applicant notes for their org"
  ON public.applicant_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      JOIN public.locations l ON l.id = ja.location_id
      WHERE ja.id = applicant_notes.application_id
        AND public.can_manage_org_applications(auth.uid(), l.organization_id)
    )
  );

CREATE POLICY "Users can create applicant notes for their org"
  ON public.applicant_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      JOIN public.locations l ON l.id = ja.location_id
      WHERE ja.id = application_id
        AND public.can_manage_org_applications(auth.uid(), l.organization_id)
    )
  );

CREATE POLICY "Users can delete their own applicant notes"
  ON public.applicant_notes FOR DELETE
  USING (created_by = auth.uid());