ALTER TABLE public.pfg_orders
  ADD COLUMN IF NOT EXISTS source_delivery_key TEXT;

COMMENT ON COLUMN public.pfg_orders.source_delivery_key IS
  'Native DeliveryKey string returned by PFG GetSubmittedOrderHeaders / GetDeliveries. Use verbatim when calling GetDeliveryDetail. NULL for legacy rows written before 2026-06-11.';

CREATE INDEX IF NOT EXISTS idx_pfg_orders_source_delivery_key
  ON public.pfg_orders (location_id, source_delivery_key)
  WHERE source_delivery_key IS NOT NULL;