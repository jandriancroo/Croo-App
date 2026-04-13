
CREATE OR REPLACE FUNCTION propagate_brand_pack_override()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_units integer;
BEGIN
  -- Calculate total units per case
  IF NEW.pack_override_outer_qty IS NOT NULL THEN
    IF NEW.pack_override_inner_qty IS NOT NULL AND NEW.pack_override_inner_qty > 0 THEN
      v_total_units := NEW.pack_override_outer_qty * NEW.pack_override_inner_qty;
    ELSE
      v_total_units := NEW.pack_override_outer_qty;
    END IF;
  ELSE
    v_total_units := NULL;
  END IF;

  -- Propagate to all local inventory items linked to this brand template
  UPDATE inventory_items
  SET pack_quantity_override = v_total_units
  WHERE brand_item_id = NEW.id
    AND is_active = true;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_propagate_brand_pack_override
AFTER UPDATE OF pack_override_outer_qty, pack_override_inner_qty ON brand_inventory_templates
FOR EACH ROW
WHEN (
  OLD.pack_override_outer_qty IS DISTINCT FROM NEW.pack_override_outer_qty
  OR OLD.pack_override_inner_qty IS DISTINCT FROM NEW.pack_override_inner_qty
)
EXECUTE FUNCTION propagate_brand_pack_override();
