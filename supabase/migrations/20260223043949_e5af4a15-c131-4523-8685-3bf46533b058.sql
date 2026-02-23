
-- Add daily tracking flag to inventory items
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS is_daily_tracked boolean NOT NULL DEFAULT false;

-- Daily spot count sessions (info-only, separate from official counts)
CREATE TABLE public.daily_spot_counts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  count_date DATE NOT NULL,
  counted_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, count_date)
);

-- Daily spot count item entries
CREATE TABLE public.daily_spot_count_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spot_count_id UUID NOT NULL REFERENCES public.daily_spot_counts(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  previous_quantity NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(spot_count_id, item_id)
);

-- Enable RLS
ALTER TABLE public.daily_spot_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_spot_count_items ENABLE ROW LEVEL SECURITY;

-- RLS using existing has_location_access function
CREATE POLICY "Users can view spot counts" ON public.daily_spot_counts
  FOR SELECT USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can insert spot counts" ON public.daily_spot_counts
  FOR INSERT WITH CHECK (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update spot counts" ON public.daily_spot_counts
  FOR UPDATE USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can view spot count items" ON public.daily_spot_count_items
  FOR SELECT USING (
    spot_count_id IN (SELECT id FROM daily_spot_counts WHERE has_location_access(auth.uid(), location_id))
  );

CREATE POLICY "Users can insert spot count items" ON public.daily_spot_count_items
  FOR INSERT WITH CHECK (
    spot_count_id IN (SELECT id FROM daily_spot_counts WHERE has_location_access(auth.uid(), location_id))
  );

CREATE POLICY "Users can update spot count items" ON public.daily_spot_count_items
  FOR UPDATE USING (
    spot_count_id IN (SELECT id FROM daily_spot_counts WHERE has_location_access(auth.uid(), location_id))
  );

-- Indexes
CREATE INDEX idx_daily_spot_counts_location_date ON public.daily_spot_counts(location_id, count_date DESC);
CREATE INDEX idx_daily_spot_count_items_spot_count ON public.daily_spot_count_items(spot_count_id);
CREATE INDEX idx_inventory_items_daily_tracked ON public.inventory_items(location_id) WHERE is_daily_tracked = true;
