-- Add payments_data column to store payment type breakdown
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS payments_data JSONB DEFAULT '{}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.sales_cache.payments_data IS 'Payment type breakdown from QuBeyond: Cash, Credit Card, OLO Doordash, etc. with amounts';