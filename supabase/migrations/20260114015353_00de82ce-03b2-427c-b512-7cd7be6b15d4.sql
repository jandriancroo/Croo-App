-- Add lock_until_time column to checklists table
ALTER TABLE public.checklists 
ADD COLUMN lock_until_time TIME WITHOUT TIME ZONE DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.checklists.lock_until_time IS 'Time of day before which the checklist is locked and cannot be completed';