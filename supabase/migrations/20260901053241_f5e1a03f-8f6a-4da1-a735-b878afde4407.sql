ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS unpriced_since timestamptz,
  ADD COLUMN IF NOT EXISTS discontinued_at timestamptz,
  ADD COLUMN IF NOT EXISTS price_source text,
  ADD COLUMN IF NOT EXISTS price_source_ref text,
  ADD COLUMN IF NOT EXISTS price_source_date date,
  ADD COLUMN IF NOT EXISTS ship_in_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_items.unpriced_since IS 'First night this item was seen with no resolvable price. Cleared when a price lands. Never drives is_active.';
COMMENT ON COLUMN public.inventory_items.discontinued_at IS 'Set when the item vanished from its master list AND had no order/invoice activity in the 14-day window. Tag only.';
COMMENT ON COLUMN public.inventory_items.price_source IS 'master | order | invoice | blended | manual';
COMMENT ON COLUMN public.inventory_items.ship_in_only IS 'Priced from order/invoice history only; not on the vendor master list (LTO / forced ship-in).';

CREATE INDEX IF NOT EXISTS idx_inventory_items_unpriced
  ON public.inventory_items (location_id)
  WHERE unpriced_since IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vendor_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL,
  vendor text NOT NULL,
  stage text NOT NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  items_seen integer NOT NULL DEFAULT 0,
  items_priced integer NOT NULL DEFAULT 0,
  items_unpriced integer NOT NULL DEFAULT 0,
  gaps_raised integer NOT NULL DEFAULT 0,
  pack_configs_queued integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_sync_runs_scope
  ON public.vendor_sync_runs (run_date, vendor, stage, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_vendor_sync_runs_date ON public.vendor_sync_runs (run_date DESC);

GRANT SELECT ON public.vendor_sync_runs TO authenticated;
GRANT ALL ON public.vendor_sync_runs TO service_role;

ALTER TABLE public.vendor_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view vendor sync runs"
ON public.vendor_sync_runs FOR SELECT TO authenticated
USING (public.has_role_or_higher(auth.uid(), 'manager'));

CREATE TRIGGER update_vendor_sync_runs_updated_at
BEFORE UPDATE ON public.vendor_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();