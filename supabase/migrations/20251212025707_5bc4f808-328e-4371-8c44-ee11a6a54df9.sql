-- Add pay period configuration to labor_rules
ALTER TABLE public.labor_rules
ADD COLUMN pay_period_type text NOT NULL DEFAULT 'biweekly',
ADD COLUMN pay_period_start_date date;

-- Add comment for documentation
COMMENT ON COLUMN public.labor_rules.pay_period_type IS 'Options: weekly, biweekly, semimonthly (1st & 15th), monthly';
COMMENT ON COLUMN public.labor_rules.pay_period_start_date IS 'Start date for calculating pay periods (used for weekly/biweekly)';