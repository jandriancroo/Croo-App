-- Add column to store snapshot of shifts at publish time
ALTER TABLE public.schedules 
ADD COLUMN published_shifts_snapshot JSONB DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.schedules.published_shifts_snapshot IS 'Stores snapshot of shifts at last publish time for change detection';