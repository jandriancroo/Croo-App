-- Add period tracking to inventory_counts
ALTER TABLE public.inventory_counts
ADD COLUMN period_type TEXT, -- 'weekly', 'monthly', 'yearly'
ADD COLUMN period_end_date DATE; -- The ending date for the period (e.g., week ending Sunday, month end, year end)

-- Add index for querying by period
CREATE INDEX idx_inventory_counts_period ON public.inventory_counts(location_id, period_type, period_end_date);