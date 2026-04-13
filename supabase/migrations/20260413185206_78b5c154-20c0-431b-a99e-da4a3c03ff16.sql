
-- Step 1: Add count_unit and count_units_per_case to brand_inventory_templates
ALTER TABLE public.brand_inventory_templates
  ADD COLUMN IF NOT EXISTS count_unit text,
  ADD COLUMN IF NOT EXISTS count_units_per_case numeric;

-- Step 2: Create cascade trigger for count unit changes
CREATE OR REPLACE FUNCTION public.fn_propagate_brand_count_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Propagate count_unit changes
  IF NEW.count_unit IS DISTINCT FROM OLD.count_unit THEN
    UPDATE inventory_items
    SET count_unit = NEW.count_unit
    WHERE brand_item_id = NEW.id;
  END IF;

  -- Propagate count_units_per_case changes
  IF NEW.count_units_per_case IS DISTINCT FROM OLD.count_units_per_case THEN
    UPDATE inventory_items
    SET count_units_per_case = NEW.count_units_per_case
    WHERE brand_item_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_propagate_brand_count_unit
  AFTER UPDATE OF count_unit, count_units_per_case
  ON public.brand_inventory_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_propagate_brand_count_unit();
