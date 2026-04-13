
-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.cascade_brand_template_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE inventory_items
  SET name = NEW.product_name, updated_at = now()
  WHERE brand_item_id = NEW.id
    AND name IS DISTINCT FROM NEW.product_name;
  RETURN NEW;
END;
$$;

-- 2. Create the trigger (only fires when product_name actually changes)
CREATE TRIGGER trg_cascade_brand_template_name
AFTER UPDATE OF product_name ON public.brand_inventory_templates
FOR EACH ROW
WHEN (OLD.product_name IS DISTINCT FROM NEW.product_name)
EXECUTE FUNCTION public.cascade_brand_template_name();

-- 3. Backfill: fix all currently out-of-sync names
UPDATE inventory_items i
SET name = b.product_name, updated_at = now()
FROM brand_inventory_templates b
WHERE i.brand_item_id = b.id
  AND i.name IS DISTINCT FROM b.product_name;
