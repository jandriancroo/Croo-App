-- Create labor_rules table for location-specific labor calculation rules
CREATE TABLE IF NOT EXISTS public.labor_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  state_code TEXT,
  overtime_threshold NUMERIC DEFAULT 40,
  overtime_multiplier NUMERIC DEFAULT 1.5,
  double_time_threshold NUMERIC,
  double_time_multiplier NUMERIC DEFAULT 2.0,
  meal_break_hours NUMERIC,
  meal_break_duration INTEGER,
  rest_break_hours NUMERIC,
  rest_break_duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.labor_rules ENABLE ROW LEVEL SECURITY;

-- Admins can manage labor rules
CREATE POLICY "Admins can manage labor rules"
  ON public.labor_rules
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Users can view labor rules for their locations
CREATE POLICY "Users can view labor rules for their locations"
  ON public.labor_rules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_locations
      WHERE user_locations.location_id = labor_rules.location_id
      AND user_locations.user_id = auth.uid()
    )
  );