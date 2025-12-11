-- Create application status enum
CREATE TYPE public.application_status AS ENUM ('pending', 'interested', 'interviewing', 'hired', 'rejected');

-- Application templates per organization
CREATE TABLE public.job_application_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Custom questions for each template
CREATE TABLE public.job_application_template_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.job_application_templates(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'text', -- text, textarea, select, checkbox, radio
  options JSONB, -- For select/radio/checkbox options
  is_required BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Main applications table
CREATE TABLE public.job_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.job_application_templates(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  location_id UUID REFERENCES public.locations(id),
  status application_status NOT NULL DEFAULT 'pending',
  
  -- Basic info
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  
  -- Availability (AM/PM for each day)
  availability JSONB NOT NULL DEFAULT '{}', -- {"monday": {"am": true, "pm": false}, ...}
  
  -- Resume
  resume_url TEXT,
  
  -- Custom question responses
  custom_responses JSONB DEFAULT '{}',
  
  -- Notes from reviewers
  internal_notes TEXT,
  
  -- Timestamps
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMP WITH TIME ZONE
);

-- Work history entries
CREATE TABLE public.job_application_work_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  employer_name TEXT NOT NULL,
  job_title TEXT,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT false,
  reason_for_leaving TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- References
CREATE TABLE public.job_application_references (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  email TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.job_application_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application_template_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application_work_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_application_references ENABLE ROW LEVEL SECURITY;

-- RLS Policies for templates
CREATE POLICY "Org admins can manage templates"
ON public.job_application_templates
FOR ALL
USING (is_org_admin(auth.uid(), organization_id) OR is_super_admin(auth.uid()))
WITH CHECK (is_org_admin(auth.uid(), organization_id) OR is_super_admin(auth.uid()));

CREATE POLICY "Public can view active templates"
ON public.job_application_templates
FOR SELECT
USING (is_active = true);

-- RLS Policies for template questions
CREATE POLICY "Org admins can manage template questions"
ON public.job_application_template_questions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.job_application_templates t
    WHERE t.id = template_id
    AND (is_org_admin(auth.uid(), t.organization_id) OR is_super_admin(auth.uid()))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.job_application_templates t
    WHERE t.id = template_id
    AND (is_org_admin(auth.uid(), t.organization_id) OR is_super_admin(auth.uid()))
  )
);

CREATE POLICY "Public can view questions for active templates"
ON public.job_application_template_questions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.job_application_templates t
    WHERE t.id = template_id AND t.is_active = true
  )
);

-- RLS Policies for applications (public can submit, org admins can view)
CREATE POLICY "Anyone can submit applications"
ON public.job_applications
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Org admins can view and manage applications"
ON public.job_applications
FOR ALL
USING (is_org_admin(auth.uid(), organization_id) OR is_super_admin(auth.uid()) OR has_location_access(auth.uid(), location_id))
WITH CHECK (is_org_admin(auth.uid(), organization_id) OR is_super_admin(auth.uid()) OR has_location_access(auth.uid(), location_id));

-- RLS Policies for work history (follows application access)
CREATE POLICY "Anyone can insert work history"
ON public.job_application_work_history
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Org admins can view work history"
ON public.job_application_work_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.job_applications a
    WHERE a.id = application_id
    AND (is_org_admin(auth.uid(), a.organization_id) OR is_super_admin(auth.uid()) OR has_location_access(auth.uid(), a.location_id))
  )
);

-- RLS Policies for references (follows application access)
CREATE POLICY "Anyone can insert references"
ON public.job_application_references
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Org admins can view references"
ON public.job_application_references
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.job_applications a
    WHERE a.id = application_id
    AND (is_org_admin(auth.uid(), a.organization_id) OR is_super_admin(auth.uid()) OR has_location_access(auth.uid(), a.location_id))
  )
);

-- Indexes for performance
CREATE INDEX idx_job_applications_org ON public.job_applications(organization_id);
CREATE INDEX idx_job_applications_location ON public.job_applications(location_id);
CREATE INDEX idx_job_applications_status ON public.job_applications(status);
CREATE INDEX idx_job_applications_submitted ON public.job_applications(submitted_at DESC);
CREATE INDEX idx_job_application_templates_org ON public.job_application_templates(organization_id);

-- Trigger for updated_at
CREATE TRIGGER update_job_application_templates_updated_at
BEFORE UPDATE ON public.job_application_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_job_applications_updated_at
BEFORE UPDATE ON public.job_applications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();