-- Phase 1: Add break_type column to time_punches (nullable, additive only)
-- This is a zero-risk migration. No existing code reads or writes this column yet.
-- All existing punches remain valid. Calculations are unchanged.

ALTER TABLE public.time_punches
ADD COLUMN IF NOT EXISTS break_type TEXT
CHECK (break_type IN ('paid', 'unpaid'));

COMMENT ON COLUMN public.time_punches.break_type IS
'Normalized break classification. Only set on break_start punches. paid = 10-minute paid rest break, unpaid = 30-minute unpaid meal break. Nullable during migration; will be backfilled in Phase 2.';

-- Partial index to speed up the eventual backfill verification + future reads
CREATE INDEX IF NOT EXISTS idx_time_punches_break_type
ON public.time_punches (break_type)
WHERE punch_type = 'break_start';