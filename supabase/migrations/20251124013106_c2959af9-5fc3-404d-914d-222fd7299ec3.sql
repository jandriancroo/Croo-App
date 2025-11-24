-- Create schedules table
CREATE TABLE public.schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_published boolean DEFAULT false
);

-- Create schedule_events table
CREATE TABLE public.schedule_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id uuid REFERENCES public.schedules(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_time time NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  notes text,
  tagged_roles jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Create shift_templates table
CREATE TABLE public.shift_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  role app_role NOT NULL,
  color text DEFAULT '#ef4444',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now()
);

-- Create scheduled_shifts table
CREATE TABLE public.scheduled_shifts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id uuid REFERENCES public.schedules(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.shift_templates(id),
  user_id uuid REFERENCES auth.users(id),
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_time_off boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_shifts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for schedules
CREATE POLICY "Users can view all schedules"
  ON public.schedules FOR SELECT
  USING (true);

CREATE POLICY "Admins and managers can create schedules"
  ON public.schedules FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

CREATE POLICY "Admins and managers can update schedules"
  ON public.schedules FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- RLS Policies for schedule_events
CREATE POLICY "Users can view all events"
  ON public.schedule_events FOR SELECT
  USING (true);

CREATE POLICY "Admins and managers can manage events"
  ON public.schedule_events FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- RLS Policies for shift_templates
CREATE POLICY "Users can view all shift templates"
  ON public.shift_templates FOR SELECT
  USING (true);

CREATE POLICY "Admins and managers can manage shift templates"
  ON public.shift_templates FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- RLS Policies for scheduled_shifts
CREATE POLICY "Users can view all scheduled shifts"
  ON public.scheduled_shifts FOR SELECT
  USING (true);

CREATE POLICY "Admins and managers can manage scheduled shifts"
  ON public.scheduled_shifts FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role)
  );

-- Add triggers for updated_at
CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();