-- Add SPLH goal columns to week_template_assignments for AM/PM goals per day
ALTER TABLE public.week_template_assignments 
  ADD COLUMN am_splh_goal NUMERIC,
  ADD COLUMN pm_splh_goal NUMERIC;

-- Add weekly totals to week_templates
ALTER TABLE public.week_templates
  ADD COLUMN target_weekly_hours NUMERIC;