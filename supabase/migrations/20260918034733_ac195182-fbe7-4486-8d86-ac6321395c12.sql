DO $$
DECLARE v_before int; v_updated int; v_after int;
BEGIN
  SELECT count(*) INTO v_before FROM public.brand_inventory_templates
   WHERE status = 'archived' AND archived_at IS NULL;
  RAISE NOTICE 'BEFORE: archived without date = %', v_before;

  WITH upd AS (
    UPDATE public.brand_inventory_templates
       SET archived_at = updated_at
     WHERE status = 'archived' AND archived_at IS NULL
    RETURNING 1
  ) SELECT count(*) INTO v_updated FROM upd;

  SELECT count(*) INTO v_after FROM public.brand_inventory_templates
   WHERE status = 'archived' AND archived_at IS NULL;
  RAISE NOTICE 'Stamped % rows; AFTER: archived without date = %', v_updated, v_after;
END $$;

COMMENT ON COLUMN public.brand_inventory_templates.archived_at IS
  'Timestamp the template was archived. Maintained automatically by trigger sync_brand_template_archived_at. Values before Sep 2026 were inferred from updated_at during a one-time backfill and are approximate, not observed archive events.';

CREATE OR REPLACE FUNCTION public.sync_brand_template_archived_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  ELSIF NEW.status IS DISTINCT FROM 'archived' AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_brand_template_archived_at ON public.brand_inventory_templates;
CREATE TRIGGER trg_sync_brand_template_archived_at
BEFORE INSERT OR UPDATE OF status, archived_at ON public.brand_inventory_templates
FOR EACH ROW EXECUTE FUNCTION public.sync_brand_template_archived_at();