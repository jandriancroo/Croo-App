
-- Sync history log for PA and PFG inventory syncs
CREATE TABLE public.inventory_sync_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id),
  sync_source TEXT NOT NULL, -- 'pfg', 'produce_alliance'
  sync_type TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'scheduled'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
  items_synced INTEGER DEFAULT 0,
  orders_processed INTEGER DEFAULT 0,
  errors TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  triggered_by UUID REFERENCES public.profiles(id)
);

-- RLS
ALTER TABLE public.inventory_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with location access can view sync logs"
  ON public.inventory_sync_logs FOR SELECT
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users with location access can insert sync logs"
  ON public.inventory_sync_logs FOR INSERT
  WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users with location access can update sync logs"
  ON public.inventory_sync_logs FOR UPDATE
  USING (public.has_location_access(auth.uid(), location_id));

-- Index for quick lookups
CREATE INDEX idx_inventory_sync_logs_location ON public.inventory_sync_logs(location_id, started_at DESC);
