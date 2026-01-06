-- Add created_by column to track who performed the punch
ALTER TABLE public.time_punches
ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- Add index for better query performance
CREATE INDEX idx_time_punches_created_by ON public.time_punches(created_by);

-- Add comment for documentation
COMMENT ON COLUMN public.time_punches.created_by IS 'User who created this punch. NULL for legacy punches. If different from user_id, this was a manual entry by a manager.';