-- Update labor_rules table to support daily and weekly overtime rules
ALTER TABLE public.labor_rules
ADD COLUMN IF NOT EXISTS daily_overtime_threshold NUMERIC DEFAULT 8,
ADD COLUMN IF NOT EXISTS daily_double_time_threshold NUMERIC DEFAULT 12,
ADD COLUMN IF NOT EXISTS weekly_overtime_threshold NUMERIC DEFAULT 40;

-- Rename existing columns for clarity
ALTER TABLE public.labor_rules
RENAME COLUMN overtime_threshold TO legacy_overtime_threshold;

ALTER TABLE public.labor_rules
RENAME COLUMN double_time_threshold TO legacy_double_time_threshold;

-- Comment explaining the overtime calculation logic
COMMENT ON TABLE public.labor_rules IS 'Labor rules for calculating overtime. Daily OT is calculated first (hours over daily_overtime_threshold), then weekly OT is calculated (hours over weekly_overtime_threshold). The employee receives whichever amount is higher. Daily double time applies to hours over daily_double_time_threshold. Meal breaks are deducted from total hours before calculating overtime.';

-- Update existing rules to use new column structure
UPDATE public.labor_rules
SET daily_overtime_threshold = legacy_overtime_threshold,
    weekly_overtime_threshold = legacy_overtime_threshold
WHERE daily_overtime_threshold IS NULL;

-- We can drop the legacy columns after data migration
ALTER TABLE public.labor_rules
DROP COLUMN IF EXISTS legacy_overtime_threshold,
DROP COLUMN IF EXISTS legacy_double_time_threshold;