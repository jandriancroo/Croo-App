-- Create event_categories table for color-coded categories
CREATE TABLE public.event_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;

-- RLS policies for event_categories
CREATE POLICY "Users can view categories at their locations"
ON public.event_categories FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins can manage categories at their locations"
ON public.event_categories FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) AND has_location_access(auth.uid(), location_id))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND has_location_access(auth.uid(), location_id));

-- Add new columns to schedule_events
ALTER TABLE public.schedule_events
ADD COLUMN days_of_week integer[] DEFAULT NULL,
ADD COLUMN category_id uuid REFERENCES public.event_categories(id) ON DELETE SET NULL,
ADD COLUMN is_daily_task boolean NOT NULL DEFAULT false,
ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- Create event_task_completions table for tracking daily task completions
CREATE TABLE public.event_task_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.schedule_events(id) ON DELETE CASCADE,
  completed_date date NOT NULL,
  completed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(event_id, completed_date)
);

-- Enable RLS
ALTER TABLE public.event_task_completions ENABLE ROW LEVEL SECURITY;

-- RLS policies for event_task_completions
CREATE POLICY "Users can view completions at their locations"
ON public.event_task_completions FOR SELECT
USING (EXISTS (
  SELECT 1 FROM schedule_events se 
  WHERE se.id = event_task_completions.event_id 
  AND has_location_access(auth.uid(), se.location_id)
));

CREATE POLICY "Users can create completions"
ON public.event_task_completions FOR INSERT
WITH CHECK (auth.uid() = completed_by AND EXISTS (
  SELECT 1 FROM schedule_events se 
  WHERE se.id = event_task_completions.event_id 
  AND has_location_access(auth.uid(), se.location_id)
));

CREATE POLICY "Admins can delete completions"
ON public.event_task_completions FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) AND EXISTS (
  SELECT 1 FROM schedule_events se 
  WHERE se.id = event_task_completions.event_id 
  AND has_location_access(auth.uid(), se.location_id)
));