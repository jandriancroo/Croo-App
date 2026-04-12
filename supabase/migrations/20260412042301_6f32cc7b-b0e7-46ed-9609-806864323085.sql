
-- Add period locking columns to inventory_counts
ALTER TABLE public.inventory_counts 
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS locked_by UUID DEFAULT NULL;

-- Create trigger to auto-lock on completion
CREATE OR REPLACE FUNCTION public.auto_lock_inventory_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Auto-lock when status changes to completed
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    NEW.locked_at := NOW();
    NEW.locked_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_lock_inventory_count
  BEFORE UPDATE ON public.inventory_counts
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_lock_inventory_count();
