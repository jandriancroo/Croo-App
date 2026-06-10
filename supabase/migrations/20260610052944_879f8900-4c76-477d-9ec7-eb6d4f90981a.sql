
CREATE OR REPLACE FUNCTION public.freeze_locked_count_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_at TIMESTAMPTZ;
BEGIN
  -- Only check on UPDATE of the three snapshot columns
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- If none of the protected columns changed, allow through
  IF NEW.cost_at_count IS NOT DISTINCT FROM OLD.cost_at_count
     AND NEW.pack_quantity_at_count IS NOT DISTINCT FROM OLD.pack_quantity_at_count
     AND NEW.inner_pack_quantity_at_count IS NOT DISTINCT FROM OLD.inner_pack_quantity_at_count
  THEN
    RETURN NEW;
  END IF;

  -- Look up lock state of the parent count
  SELECT locked_at INTO v_locked_at
  FROM public.inventory_counts
  WHERE id = NEW.count_id;

  IF v_locked_at IS NOT NULL THEN
    -- Block any change to snapshot columns once the count is locked
    RAISE EXCEPTION
      'Snapshot columns (cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count) are immutable on locked count %', NEW.count_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_locked_count_snapshots ON public.inventory_count_items;

CREATE TRIGGER trg_freeze_locked_count_snapshots
BEFORE UPDATE OF cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count
ON public.inventory_count_items
FOR EACH ROW
EXECUTE FUNCTION public.freeze_locked_count_snapshots();
