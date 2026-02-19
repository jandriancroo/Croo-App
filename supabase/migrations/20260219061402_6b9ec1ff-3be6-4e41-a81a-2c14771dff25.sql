-- Add duration tracking to inventory counts
ALTER TABLE public.inventory_counts
ADD COLUMN duration_seconds integer DEFAULT NULL;

COMMENT ON COLUMN public.inventory_counts.duration_seconds IS 'Total elapsed seconds spent actively counting this inventory session';