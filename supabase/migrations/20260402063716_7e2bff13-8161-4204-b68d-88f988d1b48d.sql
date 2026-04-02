
-- Add reporting time fields to presets
ALTER TABLE public.labor_rule_presets
  ADD COLUMN reporting_time_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN reporting_time_min_hours numeric DEFAULT NULL,
  ADD COLUMN reporting_time_max_hours numeric DEFAULT NULL;

-- Add reporting time fields to location-level rules
ALTER TABLE public.labor_rules
  ADD COLUMN reporting_time_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN reporting_time_min_hours numeric DEFAULT NULL,
  ADD COLUMN reporting_time_max_hours numeric DEFAULT NULL;

-- Update CA preset: half of scheduled shift, min 2h, max 4h
UPDATE public.labor_rule_presets
SET reporting_time_enabled = true, reporting_time_min_hours = 2, reporting_time_max_hours = 4
WHERE state_code = 'CA';

-- Update NV preset: minimum 3h if called in
UPDATE public.labor_rule_presets
SET reporting_time_enabled = true, reporting_time_min_hours = 3, reporting_time_max_hours = NULL
WHERE state_code = 'NV';
