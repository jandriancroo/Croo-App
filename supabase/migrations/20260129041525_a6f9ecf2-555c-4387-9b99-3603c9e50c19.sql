-- Create quick task templates table
CREATE TABLE public.quick_task_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Core task settings
  task_style TEXT NOT NULL DEFAULT 'standard',
  accent_color TEXT NOT NULL DEFAULT '#8B5CF6',
  
  -- Standard task defaults
  default_duration TEXT DEFAULT 'none',
  
  -- Alarm task settings
  days_of_week INTEGER[],
  frequency_type TEXT,
  frequency_minutes INTEGER,
  custom_times TEXT[],
  alarm_start_time TIME,
  alarm_end_time TIME,
  notify_only_working BOOLEAN DEFAULT TRUE,
  push_enabled BOOLEAN DEFAULT TRUE,
  show_on_punch_clock BOOLEAN DEFAULT FALSE,
  show_on_dashboard BOOLEAN DEFAULT TRUE,
  
  -- QR task settings
  is_qr_triggered BOOLEAN DEFAULT FALSE,
  qr_issue_options TEXT[],
  qr_allow_notes BOOLEAN DEFAULT TRUE,
  qr_notify_punch_clock BOOLEAN DEFAULT TRUE,
  
  -- Assignment defaults
  assignment_type TEXT DEFAULT 'employees',
  default_roles TEXT[],
  
  -- Subtask templates (JSON array)
  subtasks JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.quick_task_templates ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view templates at their locations"
ON public.quick_task_templates
FOR SELECT
USING (
  has_location_access(auth.uid(), location_id)
);

CREATE POLICY "Managers can create templates"
ON public.quick_task_templates
FOR INSERT
WITH CHECK (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Managers can update templates"
ON public.quick_task_templates
FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Managers can delete templates"
ON public.quick_task_templates
FOR DELETE
USING (
  has_location_access(auth.uid(), location_id) 
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);

-- Create trigger for updated_at
CREATE TRIGGER update_quick_task_templates_updated_at
BEFORE UPDATE ON public.quick_task_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();