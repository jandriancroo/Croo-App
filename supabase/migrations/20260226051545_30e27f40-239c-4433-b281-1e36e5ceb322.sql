
-- Add Fresh KDS location ID mapping to locations table
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS fresh_kds_location_id TEXT;

-- Create KDS cache table for ticket time metrics
CREATE TABLE public.kds_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id),
  metric_date DATE NOT NULL,
  avg_ticket_time NUMERIC,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, metric_date)
);

-- Enable RLS
ALTER TABLE public.kds_cache ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read KDS cache
CREATE POLICY "Authenticated users can read kds_cache"
  ON public.kds_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Service role inserts (edge function)
CREATE POLICY "Service role can manage kds_cache"
  ON public.kds_cache FOR ALL
  USING (true)
  WITH CHECK (true);
