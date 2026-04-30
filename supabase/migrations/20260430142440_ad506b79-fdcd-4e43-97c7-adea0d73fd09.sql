
-- 1) Repoint archived → live successor templates in recipe ingredients
UPDATE recipe_blueprint_ingredients
SET vendor_item_id = '483a58bd-8e27-4e42-852d-89a1f68385b9'
WHERE vendor_item_id = '151b15c0-55af-42ae-927c-3f68713e90c8';

UPDATE recipe_blueprint_ingredients
SET vendor_item_id = '0c3875af-280e-4f48-9f14-69cbc9a01cc5'
WHERE vendor_item_id = '2d182b2a-8a94-4bb4-8383-989c8d36bc58';

-- 2) Governance guard: block archiving a template still in use by active recipes
CREATE OR REPLACE FUNCTION public.guard_template_archive_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_count INTEGER;
BEGIN
  -- Only act when status is transitioning TO 'archived'
  IF NEW.status = 'archived' AND (OLD.status IS DISTINCT FROM 'archived') THEN
    SELECT COUNT(*)
      INTO ref_count
      FROM recipe_blueprint_ingredients rbi
      JOIN recipe_blueprints rb ON rb.id = rbi.blueprint_id
     WHERE rbi.vendor_item_id = NEW.id
       AND rb.is_active = true;

    IF ref_count > 0 THEN
      RAISE EXCEPTION
        'Cannot archive brand template "%" — still referenced by % active recipe ingredient row(s). Repoint or deactivate those recipes first.',
        NEW.product_name, ref_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_template_archive_in_use ON public.brand_inventory_templates;
CREATE TRIGGER trg_guard_template_archive_in_use
  BEFORE UPDATE OF status ON public.brand_inventory_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_template_archive_in_use();
