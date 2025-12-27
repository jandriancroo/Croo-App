-- Create table for daily settings per week template (labor %, projected sales)
CREATE TABLE public.week_template_day_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_template_id UUID NOT NULL REFERENCES public.week_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  labor_percentage_target NUMERIC(5,2) DEFAULT NULL,
  projected_sales NUMERIC(10,2) DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (week_template_id, day_of_week)
);

-- Create table for hourly coverage requirements per week template
CREATE TABLE public.week_template_hourly_coverage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  week_template_id UUID NOT NULL REFERENCES public.week_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  min_staff INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (week_template_id, day_of_week, hour)
);

-- Add min/max weekly hours to profiles for employee hour preferences
ALTER TABLE public.profiles 
ADD COLUMN min_weekly_hours NUMERIC(4,1) DEFAULT NULL,
ADD COLUMN max_weekly_hours NUMERIC(4,1) DEFAULT NULL;

-- Enable RLS on new tables
ALTER TABLE public.week_template_day_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_template_hourly_coverage ENABLE ROW LEVEL SECURITY;

-- RLS policies for week_template_day_settings
CREATE POLICY "Users can view day settings for their locations"
ON public.week_template_day_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_id
    AND public.has_location_access(auth.uid(), wt.location_id)
  )
);

CREATE POLICY "Managers can manage day settings"
ON public.week_template_day_settings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_id
    AND public.has_location_access(auth.uid(), wt.location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_id
    AND public.has_location_access(auth.uid(), wt.location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  )
);

-- RLS policies for week_template_hourly_coverage
CREATE POLICY "Users can view hourly coverage for their locations"
ON public.week_template_hourly_coverage
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_id
    AND public.has_location_access(auth.uid(), wt.location_id)
  )
);

CREATE POLICY "Managers can manage hourly coverage"
ON public.week_template_hourly_coverage
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_id
    AND public.has_location_access(auth.uid(), wt.location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.week_templates wt
    WHERE wt.id = week_template_id
    AND public.has_location_access(auth.uid(), wt.location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  )
);

-- Create updated_at triggers
CREATE TRIGGER update_week_template_day_settings_updated_at
BEFORE UPDATE ON public.week_template_day_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_week_template_hourly_coverage_updated_at
BEFORE UPDATE ON public.week_template_hourly_coverage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();