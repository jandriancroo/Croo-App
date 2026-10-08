DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['labor_rules','labor_rule_presets'] LOOP
    EXECUTE format($f$ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS second_meal_break_hours numeric,
      ADD COLUMN IF NOT EXISTS meal_waiver_max_hours numeric,
      ADD COLUMN IF NOT EXISTS long_break_grace_minutes int NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS long_shift_hours numeric NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS meal_rule_basis text NOT NULL DEFAULT 'law' CHECK (meal_rule_basis IN ('law','company','none')),
      ADD COLUMN IF NOT EXISTS meal_break_paid boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS meal_deadline_hours numeric,
      ADD COLUMN IF NOT EXISTS second_meal_waiver_max_hours numeric,
      ADD COLUMN IF NOT EXISTS rest_break_paid boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS flag_rest_breaks boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS min_hours_between_shifts numeric,
      ADD COLUMN IF NOT EXISTS split_shift_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS split_shift_gap_minutes int,
      ADD COLUMN IF NOT EXISTS minor_rules jsonb$f$, t);
  END LOOP;
END $$;

ALTER TABLE public.labor_rules
  ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rules_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rules_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS laws_checked_at timestamptz;

ALTER TABLE public.labor_rules ADD CONSTRAINT labor_rules_location_id_key UNIQUE (location_id);

UPDATE public.labor_rule_presets SET second_meal_break_hours = 10, second_meal_waiver_max_hours = 12,
  meal_deadline_hours = 5, split_shift_enabled = true, split_shift_gap_minutes = 60 WHERE state_code = 'CA';
UPDATE public.labor_rule_presets SET meal_rule_basis = 'none' WHERE meal_break_hours IS NULL;

UPDATE public.labor_rules SET meal_rule_basis = 'none',
  field_sources = field_sources || jsonb_build_object('meal_rule_basis', jsonb_build_object('source','migration','at',now()))
 WHERE meal_break_hours IS NULL;

UPDATE public.labor_rules lr SET
  second_meal_break_hours = coalesce(lr.second_meal_break_hours, 10),
  second_meal_waiver_max_hours = coalesce(lr.second_meal_waiver_max_hours, 12),
  meal_deadline_hours = coalesce(lr.meal_deadline_hours, 5),
  split_shift_enabled = true,
  split_shift_gap_minutes = coalesce(lr.split_shift_gap_minutes, 60),
  field_sources = lr.field_sources
    || CASE WHEN lr.second_meal_break_hours IS NULL THEN jsonb_build_object('second_meal_break_hours', jsonb_build_object('source','migration','at',now())) ELSE '{}'::jsonb END
    || CASE WHEN lr.second_meal_waiver_max_hours IS NULL THEN jsonb_build_object('second_meal_waiver_max_hours', jsonb_build_object('source','migration','at',now())) ELSE '{}'::jsonb END
    || CASE WHEN lr.meal_deadline_hours IS NULL THEN jsonb_build_object('meal_deadline_hours', jsonb_build_object('source','migration','at',now())) ELSE '{}'::jsonb END
    || CASE WHEN NOT lr.split_shift_enabled THEN jsonb_build_object('split_shift_enabled', jsonb_build_object('source','migration','at',now())) ELSE '{}'::jsonb END
    || CASE WHEN lr.split_shift_gap_minutes IS NULL THEN jsonb_build_object('split_shift_gap_minutes', jsonb_build_object('source','migration','at',now())) ELSE '{}'::jsonb END
 WHERE lr.state_code = 'CA';

CREATE TABLE public.labor_rules_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  source text NOT NULL CHECK (source IN ('manual','preset','migration','ai')),
  proposal_id uuid,
  before jsonb,
  after jsonb,
  note text
);
GRANT SELECT ON public.labor_rules_history TO authenticated;
GRANT ALL ON public.labor_rules_history TO service_role;
ALTER TABLE public.labor_rules_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Location members can view labor rules history" ON public.labor_rules_history
  FOR SELECT TO authenticated USING (public.has_location_access(auth.uid(), location_id));
CREATE INDEX labor_rules_history_loc_changed_idx ON public.labor_rules_history (location_id, changed_at DESC);