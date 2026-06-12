
CREATE OR REPLACE FUNCTION public.enforce_inventory_enabled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_name text;
BEGIN
  SELECT inventory_enabled, name
    INTO v_enabled, v_name
  FROM public.locations
  WHERE id = NEW.location_id;

  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Inventory is not enabled for location % (%). Enable inventory_enabled before creating counts.', v_name, NEW.location_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_counts_enforce_enabled ON public.inventory_counts;

CREATE TRIGGER trg_inventory_counts_enforce_enabled
BEFORE INSERT ON public.inventory_counts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_inventory_enabled();
