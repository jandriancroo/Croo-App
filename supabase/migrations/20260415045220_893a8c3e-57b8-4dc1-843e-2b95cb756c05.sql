-- 1. Unique constraint: one active item per brand template per location
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_active_brand
ON public.inventory_items (location_id, brand_item_id)
WHERE is_active = true AND brand_item_id IS NOT NULL;

-- 2. Check constraint: active items must have a brand_item_id
-- Use a validation trigger instead of CHECK constraint for flexibility
CREATE OR REPLACE FUNCTION public.trg_validate_active_brand_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active = true AND NEW.brand_item_id IS NULL THEN
    RAISE EXCEPTION 'Active inventory items must have a brand_item_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_active_brand_link ON public.inventory_items;
CREATE TRIGGER trg_validate_active_brand_link
BEFORE INSERT OR UPDATE ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_validate_active_brand_link();

-- 3. Count history snapshot columns
ALTER TABLE public.inventory_count_items
ADD COLUMN IF NOT EXISTS item_name_at_count TEXT,
ADD COLUMN IF NOT EXISTS cost_at_count NUMERIC,
ADD COLUMN IF NOT EXISTS unit_at_count TEXT;