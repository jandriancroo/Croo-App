-- Add validation columns and YoY reference columns to sales_cache
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS validation_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS flagged_no_sales BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS yoy_sale_date DATE,
ADD COLUMN IF NOT EXISTS yoy_net_sales NUMERIC,
ADD COLUMN IF NOT EXISTS yoy_hourly_data JSONB;

-- Add index for faster YoY lookups
CREATE INDEX IF NOT EXISTS idx_sales_cache_location_date ON public.sales_cache(location_id, sale_date);

-- Add weekly and monthly aggregate table for faster projections
CREATE TABLE IF NOT EXISTS public.sales_aggregates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  net_sales NUMERIC NOT NULL DEFAULT 0,
  guest_count INTEGER NOT NULL DEFAULT 0,
  pizza_count INTEGER NOT NULL DEFAULT 0,
  avg_daily_sales NUMERIC,
  days_with_sales INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, aggregate_type, period_start)
);

-- Enable RLS
ALTER TABLE public.sales_aggregates ENABLE ROW LEVEL SECURITY;

-- RLS policies for sales_aggregates
CREATE POLICY "Users can view sales aggregates for their locations"
ON public.sales_aggregates FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Service role can manage sales aggregates"
ON public.sales_aggregates FOR ALL
USING (true)
WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_sales_aggregates_updated_at
BEFORE UPDATE ON public.sales_aggregates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();