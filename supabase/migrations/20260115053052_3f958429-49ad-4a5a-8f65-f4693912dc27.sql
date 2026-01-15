-- Add projection columns to sales_cache for the new projection system
-- Existing projected_sales column will become initial_projection equivalent
-- This preserves all existing data

-- Add living_projection: Updated daily at 2 AM for days within 7-day window
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS living_projection NUMERIC;

-- Add override_projection: Manager manual override (highest priority)
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS override_projection NUMERIC;

-- Add override metadata
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ;

ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS override_by UUID REFERENCES auth.users(id);

-- Rename existing projected_sales to initial_projection for clarity
-- First add the new column, then copy data, then we can phase out old column
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS initial_projection NUMERIC;

-- Copy existing projected_sales data to initial_projection
UPDATE public.sales_cache 
SET initial_projection = projected_sales 
WHERE projected_sales IS NOT NULL AND initial_projection IS NULL;

-- Add comments explaining the resolution priority
COMMENT ON COLUMN public.sales_cache.initial_projection IS 'Initial projection for schedule planning (8-14 days out). Resolution: override > living > initial';
COMMENT ON COLUMN public.sales_cache.living_projection IS 'Living projection updated daily (within 7-day window)';
COMMENT ON COLUMN public.sales_cache.override_projection IS 'Manager override - highest priority when set';
COMMENT ON COLUMN public.sales_cache.override_at IS 'Timestamp when override was set';
COMMENT ON COLUMN public.sales_cache.override_by IS 'User who set the override';
COMMENT ON COLUMN public.sales_cache.projected_sales IS 'DEPRECATED - use initial_projection, living_projection, or override_projection';

-- Create index for efficient lookups by location and date range
CREATE INDEX IF NOT EXISTS idx_sales_cache_projections 
ON public.sales_cache (location_id, sale_date) 
WHERE override_projection IS NOT NULL OR living_projection IS NOT NULL;