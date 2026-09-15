-- Stage 5.4 — one canonical archive cascade, with the reason stamped.
--
-- Three triggers were doing the same "brand template left 'live' → turn the local
-- items off" cascade. Keep trg_brand_template_status_cascade (the broadest: any
-- move away from 'live', not just 'archived') and drop the other two.
DROP TRIGGER IF EXISTS trg_cascade_archive_brand_template ON public.brand_inventory_templates;
DROP TRIGGER IF EXISTS trg_deactivate_items_on_template_archive ON public.brand_inventory_templates;

CREATE OR REPLACE FUNCTION public.trg_brand_template_status_cascade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'live' THEN
    UPDATE public.inventory_items
       SET is_active = false,
           deactivated_by = 'brand_admin',
           deactivated_reason = CASE
             WHEN NEW.status = 'archived'
               THEN 'Archived brand-wide: ' || COALESCE(NEW.product_name, NEW.id::text)
             ELSE 'Brand template no longer live (' || NEW.status || '): '
                  || COALESCE(NEW.product_name, NEW.id::text)
           END,
           updated_at = now()
     WHERE brand_item_id = NEW.id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$function$;