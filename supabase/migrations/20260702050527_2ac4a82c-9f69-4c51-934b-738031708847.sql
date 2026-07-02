-- 1a. Restore governance triggers to pre-Lite bodies
CREATE OR REPLACE FUNCTION public.enforce_inventory_item_brand_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active = true AND NEW.brand_item_id IS NULL THEN
    RAISE EXCEPTION
      'inventory_items.brand_item_id is required when is_active = true (Brand Catalog governance: row %, name %)',
      NEW.id, NEW.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

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

-- 1b. Drop the three Lite-added shared columns.
--     vendor_invoice_items.match_status is INTENTIONALLY retained (pre-existed Lite).
ALTER TABLE public.inventory_items       DROP COLUMN IF EXISTS vendor_name_normalized;
ALTER TABLE public.inventory_items       DROP COLUMN IF EXISTS match_status;
ALTER TABLE public.vendor_invoice_items  DROP COLUMN IF EXISTS candidate_item_id;