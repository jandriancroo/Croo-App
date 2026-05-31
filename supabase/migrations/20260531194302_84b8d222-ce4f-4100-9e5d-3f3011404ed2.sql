ALTER TABLE public.snapshot_backfill_log
  ADD COLUMN IF NOT EXISTS old_quantity numeric,
  ADD COLUMN IF NOT EXISTS new_quantity numeric,
  ADD COLUMN IF NOT EXISTS old_baseline numeric,
  ADD COLUMN IF NOT EXISTS new_baseline numeric;