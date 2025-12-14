-- Create week_templates table to store weekly schedule templates
CREATE TABLE public.week_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name TEXT NOT NULL,
  description TEXT,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create week_template_assignments to store which shift templates are assigned to which days
CREATE TABLE public.week_template_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_template_id UUID NOT NULL REFERENCES public.week_templates(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_week_template_assignments_template ON public.week_template_assignments(week_template_id);
CREATE INDEX idx_week_templates_location ON public.week_templates(location_id);

-- Enable RLS
ALTER TABLE public.week_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_template_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for week_templates
CREATE POLICY "Users can view week templates at their locations"
ON public.week_templates
FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins and managers can manage week templates"
ON public.week_templates
FOR ALL
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  AND has_location_access(auth.uid(), location_id)
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  AND has_location_access(auth.uid(), location_id)
);

-- RLS policies for week_template_assignments
CREATE POLICY "Users can view week template assignments"
ON public.week_template_assignments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_assignments.week_template_id
    AND has_location_access(auth.uid(), wt.location_id)
  )
);

CREATE POLICY "Admins and managers can manage week template assignments"
ON public.week_template_assignments
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_assignments.week_template_id
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    AND has_location_access(auth.uid(), wt.location_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_assignments.week_template_id
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    AND has_location_access(auth.uid(), wt.location_id)
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_week_templates_updated_at
  BEFORE UPDATE ON public.week_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();