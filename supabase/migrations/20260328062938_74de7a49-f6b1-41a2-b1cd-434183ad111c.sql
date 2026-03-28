-- Step 1: Remove the 1-drawer-count-per-day restriction
-- This allows multiple drawer counts per location per day (mid-day pulls + final reconciliation)

CREATE OR REPLACE FUNCTION public.prevent_duplicate_drawer_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- This trigger previously blocked more than 1 drawer count per day.
  -- It is now a no-op to allow mid-day pulls and final reconciliation counts.
  -- The UI enforces the workflow (mid-day vs final).
  RETURN NEW;
END;
$$;