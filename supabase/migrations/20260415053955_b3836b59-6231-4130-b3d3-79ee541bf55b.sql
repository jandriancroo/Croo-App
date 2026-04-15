
CREATE OR REPLACE FUNCTION public.deactivate_items_on_template_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When a brand template is archived, deactivate all local items linked to it
  IF NEW.status = 'archived' AND (OLD.status IS DISTINCT FROM 'archived') THEN
    UPDATE public.inventory_items
    SET is_active = false
    WHERE brand_item_id = NEW.id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deactivate_items_on_template_archive
  AFTER UPDATE OF status ON public.brand_inventory_templates
  FOR EACH ROW
  WHEN (NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived')
  EXECUTE FUNCTION public.deactivate_items_on_template_archive();
