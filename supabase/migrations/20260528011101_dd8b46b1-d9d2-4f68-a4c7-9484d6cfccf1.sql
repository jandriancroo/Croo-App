ALTER TABLE public.sales_cache
  ADD COLUMN IF NOT EXISTS external_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_cache_pos_event
  ON public.sales_cache (location_id, pos_source, external_event_id)
  WHERE external_event_id IS NOT NULL;

COMMENT ON COLUMN public.sales_cache.external_event_id IS
  'Optional POS-provided unique event identifier for webhook-originated writes. Pull-based syncs (QU daily, Clover daily) leave this NULL and continue to upsert on (location_id, sale_date). Webhook writes set this and upsert on (location_id, pos_source, external_event_id) to guarantee idempotency. Partial unique index uq_sales_cache_pos_event enforces dedup only when this column is non-null.';