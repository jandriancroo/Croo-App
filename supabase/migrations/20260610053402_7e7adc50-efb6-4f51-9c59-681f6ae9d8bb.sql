
CREATE OR REPLACE FUNCTION public.freeze_locked_count_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_at TIMESTAMPTZ;
  v_bypass TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Skip if none of the protected columns changed
  IF NEW.cost_at_count IS NOT DISTINCT FROM OLD.cost_at_count
     AND NEW.pack_quantity_at_count IS NOT DISTINCT FROM OLD.pack_quantity_at_count
     AND NEW.inner_pack_quantity_at_count IS NOT DISTINCT FROM OLD.inner_pack_quantity_at_count
  THEN
    RETURN NEW;
  END IF;

  -- Explicit administrative bypass via session GUC.
  -- Must be set inside the same transaction:
  --   SELECT set_config('app.allow_snapshot_backfill', 'on', true);
  BEGIN
    v_bypass := current_setting('app.allow_snapshot_backfill', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;

  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT locked_at INTO v_locked_at
  FROM public.inventory_counts
  WHERE id = NEW.count_id;

  IF v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Snapshot columns (cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count) are immutable on locked count %. Set app.allow_snapshot_backfill=on inside the transaction to override.', NEW.count_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
