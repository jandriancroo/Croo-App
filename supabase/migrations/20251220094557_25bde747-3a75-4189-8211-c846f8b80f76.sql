-- Add projected_sales column to sales_cache
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS projected_sales numeric;

-- Add projected field to hourly_data structure (already stored as JSONB, so this is just documentation)
COMMENT ON COLUMN public.sales_cache.projected_sales IS 'Daily projected sales based on 4-week average for this day of week';
COMMENT ON COLUMN public.sales_cache.hourly_data IS 'Array of {hour, sales, checksCount, projected} objects';