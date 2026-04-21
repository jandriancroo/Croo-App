ALTER TABLE public.vendor_sku_health
  ADD COLUMN IF NOT EXISTS last_seen_on_bid_list timestamptz,
  ADD COLUMN IF NOT EXISTS days_not_seen integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_since text,
  ADD COLUMN IF NOT EXISTS manager_deactivated_override boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_vendor_sku_health_bid_list_lookup
  ON public.vendor_sku_health (brand_id, vendor_source, vendor_territory)
  WHERE manager_deactivated_override = false;