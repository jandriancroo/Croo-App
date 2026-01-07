-- Create dedicated labor cache table for data integrity
CREATE TABLE public.labor_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  labor_date DATE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('qubeyond', 'punch_clock')),
  labor_cost NUMERIC DEFAULT 0,
  labor_hours NUMERIC DEFAULT 0,
  regular_hours NUMERIC DEFAULT 0,
  overtime_hours NUMERIC DEFAULT 0,
  double_time_hours NUMERIC DEFAULT 0,
  hourly_breakdown JSONB DEFAULT '[]'::jsonb,
  employee_breakdown JSONB DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint: one entry per location/date/source
  CONSTRAINT labor_cache_unique UNIQUE (location_id, labor_date, source)
);

-- Index for fast lookups
CREATE INDEX idx_labor_cache_location_date ON public.labor_cache(location_id, labor_date);
CREATE INDEX idx_labor_cache_source ON public.labor_cache(source);

-- Enable RLS
ALTER TABLE public.labor_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies (same pattern as sales_cache)
CREATE POLICY "Users can view labor cache for their locations"
ON public.labor_cache FOR SELECT
USING (
  public.has_location_access(auth.uid(), location_id)
  OR public.has_brand_access_via_location(auth.uid(), location_id)
);

CREATE POLICY "Service role can manage labor cache"
ON public.labor_cache FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_labor_cache_updated_at
  BEFORE UPDATE ON public.labor_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Migrate existing labor data from sales_cache (mark as qubeyond source)
INSERT INTO public.labor_cache (
  location_id,
  labor_date,
  source,
  labor_cost,
  labor_hours,
  regular_hours,
  overtime_hours,
  fetched_at,
  created_at
)
SELECT 
  location_id,
  sale_date,
  'qubeyond',
  COALESCE(labor_cost, 0),
  COALESCE(labor_hours, 0),
  COALESCE(regular_hours, 0),
  COALESCE(overtime_hours, 0),
  fetched_at,
  created_at
FROM public.sales_cache
WHERE labor_cost IS NOT NULL OR labor_hours IS NOT NULL
ON CONFLICT (location_id, labor_date, source) DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE public.labor_cache IS 'Dedicated labor data cache. Stores labor from multiple sources (qubeyond, punch_clock) with full audit trail. Created for data integrity when scaling to multiple locations.';