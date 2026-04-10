ALTER TABLE public.kds_orders ADD COLUMN IF NOT EXISTS promised_time timestamptz DEFAULT NULL;
ALTER TABLE public.kds_orders ADD COLUMN IF NOT EXISTS external_order_id text DEFAULT NULL;