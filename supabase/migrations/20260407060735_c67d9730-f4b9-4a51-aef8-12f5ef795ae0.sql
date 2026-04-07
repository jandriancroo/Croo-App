
-- Step 1: Deactivate all Hemet items linked to non-live brand templates
UPDATE public.inventory_items i
SET is_active = false, updated_at = now()
FROM brand_inventory_templates bt
WHERE i.brand_item_id = bt.id
  AND i.location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
  AND i.is_active = true
  AND bt.status != 'live';

-- Step 2: Create cascade trigger for future archiving
CREATE OR REPLACE FUNCTION public.cascade_archive_brand_template()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When a brand template is archived, deactivate all linked local items
  IF NEW.status = 'archived' AND OLD.status != 'archived' THEN
    UPDATE public.inventory_items
    SET is_active = false, updated_at = now()
    WHERE brand_item_id = NEW.id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to brand_inventory_templates
DROP TRIGGER IF EXISTS trg_cascade_archive_brand_template ON public.brand_inventory_templates;
CREATE TRIGGER trg_cascade_archive_brand_template
  AFTER UPDATE OF status ON public.brand_inventory_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_archive_brand_template();
