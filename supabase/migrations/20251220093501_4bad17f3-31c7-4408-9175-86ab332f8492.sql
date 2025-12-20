-- Create table to cache daily sales data from QuBeyond
-- This stores historical sales data that won't change
CREATE TABLE public.sales_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  net_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  guest_count INTEGER NOT NULL DEFAULT 0,
  pizza_count INTEGER NOT NULL DEFAULT 0,
  avg_ticket NUMERIC(10,2),
  hourly_data JSONB, -- Array of {hour, sales, checksCount}
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure one record per location per date
  CONSTRAINT sales_cache_location_date_unique UNIQUE (location_id, sale_date)
);

-- Create index for fast lookups
CREATE INDEX idx_sales_cache_location_date ON public.sales_cache(location_id, sale_date);
CREATE INDEX idx_sales_cache_sale_date ON public.sales_cache(sale_date);

-- Enable RLS
ALTER TABLE public.sales_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users who have access to the location
CREATE POLICY "Users can view sales cache for their locations"
ON public.sales_cache
FOR SELECT
USING (
  location_id IN (
    SELECT p.default_location_id FROM public.profiles p WHERE p.id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.organization_members om
    JOIN public.locations l ON l.organization_id = om.organization_id
    WHERE om.user_id = auth.uid() AND l.id = sales_cache.location_id
  )
);

-- Policy: Allow service role to insert/update (edge functions use service role)
CREATE POLICY "Service role can manage sales cache"
ON public.sales_cache
FOR ALL
USING (true)
WITH CHECK (true);

-- Add backfill_status to location_integrations to track progress
ALTER TABLE public.location_integrations 
ADD COLUMN IF NOT EXISTS backfill_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS backfill_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS backfill_completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS backfill_days_completed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS backfill_error TEXT;