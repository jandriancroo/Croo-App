
-- Break Coverage Assignments feature
ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS break_coverage_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.shift_templates
  ADD COLUMN IF NOT EXISTS breaks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.scheduled_shifts
  ADD COLUMN IF NOT EXISTS breaks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_coverage_only boolean NOT NULL DEFAULT false;
