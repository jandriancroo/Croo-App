CREATE OR REPLACE FUNCTION public.enforce_inventory_item_brand_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  loc_mode text;
BEGIN
  -- Lite locations have no Brand Catalog — items originate directly from
  -- invoice ingestion, so the brand_item_id requirement does not apply.
  SELECT inventory_mode INTO loc_mode
  FROM public.locations
  WHERE id = NEW.location_id;

  IF loc_mode = 'lite' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_active = true AND NEW.brand_item_id IS NULL THEN
    RAISE EXCEPTION
      'inventory_items.brand_item_id is required when is_active = true (Brand Catalog governance: row %, name %)',
      NEW.id, NEW.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;