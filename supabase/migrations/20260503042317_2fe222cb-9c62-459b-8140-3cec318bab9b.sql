-- 1. Strengthen the validation trigger to require brand template status = 'live'
CREATE OR REPLACE FUNCTION public.trg_validate_active_brand_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  tmpl_status text;
BEGIN
  IF NEW.is_active = true THEN
    IF NEW.brand_item_id IS NULL THEN
      RAISE EXCEPTION 'Active inventory items must have a brand_item_id';
    END IF;
    SELECT status INTO tmpl_status
      FROM public.brand_inventory_templates
     WHERE id = NEW.brand_item_id;
    IF tmpl_status IS NULL THEN
      RAISE EXCEPTION 'Active inventory item % references a missing brand template %', NEW.id, NEW.brand_item_id;
    END IF;
    IF tmpl_status <> 'live' THEN
      RAISE EXCEPTION 'Cannot activate inventory_item % — brand template % is %, not live', NEW.id, NEW.brand_item_id, tmpl_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Cascade: when a brand template leaves 'live', deactivate all linked location rows
CREATE OR REPLACE FUNCTION public.trg_brand_template_status_cascade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'live' THEN
    UPDATE public.inventory_items
       SET is_active = false
     WHERE brand_item_id = NEW.id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_brand_template_status_cascade ON public.brand_inventory_templates;
CREATE TRIGGER trg_brand_template_status_cascade
  AFTER UPDATE OF status ON public.brand_inventory_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_brand_template_status_cascade();

-- 3. One-time cleanup: deactivate currently leaked active Hemet rows linked to archived templates
UPDATE public.inventory_items ii
   SET is_active = false
  FROM public.brand_inventory_templates bit
 WHERE ii.brand_item_id = bit.id
   AND bit.status <> 'live'
   AND ii.is_active = true;