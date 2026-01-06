-- Add labor columns to sales_cache table
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS labor_cost numeric,
ADD COLUMN IF NOT EXISTS labor_hours numeric,
ADD COLUMN IF NOT EXISTS regular_hours numeric,
ADD COLUMN IF NOT EXISTS overtime_hours numeric;

-- Add index for efficient labor queries
CREATE INDEX IF NOT EXISTS idx_sales_cache_labor ON public.sales_cache (location_id, sale_date) WHERE labor_cost IS NOT NULL;