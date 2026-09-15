CREATE OR REPLACE FUNCTION public.track_cost_zeroed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- A signed-in person setting the price to zero = a deliberate choice.
  -- Background syncs run as service_role with no auth.uid(), so they can
  -- never stamp this marker.
  IF NEW.cost_per_unit IS NOT NULL AND NEW.cost_per_unit = 0
     AND (OLD.cost_per_unit IS DISTINCT FROM NEW.cost_per_unit)
     AND auth.uid() IS NOT NULL THEN
    NEW.cost_zeroed_at := now();
    NEW.cost_zeroed_by := auth.uid();
  -- Any real price (or clearing it entirely) retires the marker.
  ELSIF (NEW.cost_per_unit IS NULL OR NEW.cost_per_unit > 0)
     AND (OLD.cost_per_unit IS DISTINCT FROM NEW.cost_per_unit) THEN
    NEW.cost_zeroed_at := NULL;
    NEW.cost_zeroed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_track_cost_zeroed ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_track_cost_zeroed
BEFORE UPDATE OF cost_per_unit ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.track_cost_zeroed();

REVOKE ALL ON FUNCTION public.track_cost_zeroed() FROM anon, authenticated, PUBLIC;