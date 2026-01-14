-- Add clock-in restriction settings to labor_rules table
ALTER TABLE public.labor_rules
ADD COLUMN IF NOT EXISTS allow_unscheduled_clock_in boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS allow_early_clock_in boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS early_clock_in_minutes integer NOT NULL DEFAULT 30;

-- Add comment for documentation
COMMENT ON COLUMN public.labor_rules.allow_unscheduled_clock_in IS 'When false, employees without a scheduled shift cannot clock in';
COMMENT ON COLUMN public.labor_rules.allow_early_clock_in IS 'When false, employees must wait until exact shift start time';
COMMENT ON COLUMN public.labor_rules.early_clock_in_minutes IS 'How many minutes before shift start an employee can clock in (only used when allow_early_clock_in is true)';