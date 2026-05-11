
CREATE OR REPLACE FUNCTION public.enforce_inventory_item_brand_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = true AND NEW.brand_item_id IS NULL THEN
    RAISE EXCEPTION
      'inventory_items.brand_item_id is required when is_active = true (Brand Catalog governance: row %, name %)',
      NEW.id, NEW.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_enforce_brand_link ON public.inventory_items;

CREATE TRIGGER trg_inventory_items_enforce_brand_link
BEFORE INSERT OR UPDATE OF is_active, brand_item_id
ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_inventory_item_brand_link();
