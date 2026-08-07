ALTER TABLE public.location_plan_overrides
  ADD COLUMN IF NOT EXISTS skip_trial boolean NOT NULL DEFAULT false;