-- Add edited_by and edited_at columns to track who edited a punch (separate from created_by)
ALTER TABLE public.time_punches 
ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;