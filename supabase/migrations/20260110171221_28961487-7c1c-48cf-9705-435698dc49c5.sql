
-- Add audit tracking columns to schedules table
ALTER TABLE public.schedules 
ADD COLUMN IF NOT EXISTS last_status_changed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_status_changed_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS last_status_action TEXT; -- 'published', 'updated', 'withdrawn'

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_schedules_last_status_changed_by ON public.schedules(last_status_changed_by);

-- Add comment for documentation
COMMENT ON COLUMN public.schedules.last_status_changed_at IS 'Timestamp of the last publish/update/withdraw action';
COMMENT ON COLUMN public.schedules.last_status_changed_by IS 'User ID who performed the last publish/update/withdraw action';
COMMENT ON COLUMN public.schedules.last_status_action IS 'Type of last action: published, updated, or withdrawn';
