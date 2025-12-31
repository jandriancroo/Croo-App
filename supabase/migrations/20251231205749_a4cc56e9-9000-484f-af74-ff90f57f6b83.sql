-- Add overtime and extended break flags to time_punches
ALTER TABLE public.time_punches 
ADD COLUMN IF NOT EXISTS has_overtime boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS has_extended_break boolean NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.time_punches.has_overtime IS 'True if this shift contributes to overtime (daily or weekly threshold exceeded)';
COMMENT ON COLUMN public.time_punches.has_extended_break IS 'True if employee took longer than expected break duration';