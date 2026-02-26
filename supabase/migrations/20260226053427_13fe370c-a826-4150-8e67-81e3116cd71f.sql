-- Add order count columns to kds_cache for fast/medium/slow breakdown
ALTER TABLE public.kds_cache 
  ADD COLUMN IF NOT EXISTS orders_fast integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orders_medium integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orders_slow integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orders_total integer DEFAULT 0;