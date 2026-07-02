CREATE OR REPLACE FUNCTION public.trg_validate_active_brand_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  tmpl_status text;
  loc_mode text;
BEGIN
  IF NEW.is_active = true THEN
    -- Lite locations have no Brand Catalog; skip the template lifecycle check.
    SELECT inventory_mode INTO loc_mode FROM public.locations WHERE id = NEW.location_id;
    IF loc_mode = 'lite' THEN
      RETURN NEW;
    END IF;

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