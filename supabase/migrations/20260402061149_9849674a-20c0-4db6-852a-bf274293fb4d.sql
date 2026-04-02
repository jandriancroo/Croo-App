-- ============================
-- 1. Global Labor Rule Presets
-- ============================
CREATE TABLE public.labor_rule_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  preset_name TEXT NOT NULL,
  state_code TEXT NOT NULL,
  daily_overtime_threshold NUMERIC NOT NULL DEFAULT 8,
  daily_double_time_threshold NUMERIC NOT NULL DEFAULT 12,
  weekly_overtime_threshold NUMERIC NOT NULL DEFAULT 40,
  overtime_multiplier NUMERIC NOT NULL DEFAULT 1.5,
  double_time_multiplier NUMERIC NOT NULL DEFAULT 2.0,
  meal_break_hours NUMERIC,
  meal_break_duration INTEGER,
  rest_break_hours NUMERIC,
  rest_break_duration INTEGER,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.labor_rule_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read presets"
  ON public.labor_rule_presets FOR SELECT
  TO authenticated USING (true);

-- Seed system presets
INSERT INTO public.labor_rule_presets (preset_name, state_code, daily_overtime_threshold, daily_double_time_threshold, weekly_overtime_threshold, overtime_multiplier, double_time_multiplier, meal_break_hours, meal_break_duration, rest_break_hours, rest_break_duration, is_system)
VALUES
  ('California', 'CA', 8, 12, 40, 1.5, 2.0, 5, 30, 4, 10, true),
  ('Texas', 'TX', 0, 0, 40, 1.5, 2.0, NULL, NULL, NULL, NULL, true),
  ('Federal Default', 'US', 0, 0, 40, 1.5, 2.0, NULL, NULL, NULL, NULL, true);

-- ============================
-- 2. Remove Location Code
-- ============================
DROP FUNCTION IF EXISTS public.generate_location_code();
DROP FUNCTION IF EXISTS public.validate_location_code(text);

ALTER TABLE public.locations DROP COLUMN IF EXISTS location_code;