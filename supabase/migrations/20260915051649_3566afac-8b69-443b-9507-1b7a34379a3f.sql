CREATE TABLE IF NOT EXISTS public.brand_deploy_trigger_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid,
  brand_id uuid,
  location_id uuid,
  phase text NOT NULL,
  url text NOT NULL,
  request_id bigint,
  status_code integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bdtl_created_at ON public.brand_deploy_trigger_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bdtl_pending ON public.brand_deploy_trigger_log (request_id) WHERE status_code IS NULL;

GRANT SELECT ON public.brand_deploy_trigger_log TO authenticated;
GRANT ALL ON public.brand_deploy_trigger_log TO service_role;

ALTER TABLE public.brand_deploy_trigger_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deploy trigger log"
ON public.brand_deploy_trigger_log
FOR SELECT
TO authenticated
USING (public.has_role_or_higher(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.reconcile_brand_deploy_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.brand_deploy_trigger_log l
    SET status_code = r.status_code,
        response_body = left(coalesce(r.content, r.error_msg, ''), 500),
        resolved_at = now()
    FROM net._http_response r
    WHERE r.id = l.request_id
      AND l.status_code IS NULL
      AND l.created_at > now() - interval '2 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_brand_deploy_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_brand_deploy_log() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_deploy_brand_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_brand_id uuid;
  v_loc RECORD;
  v_base_url text := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/deploy-location-inventory';
  v_chase_url text := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/vendor-price-chase';
  v_anon_key text;
  v_req_id bigint;
BEGIN
  v_brand_id := NEW.brand_id;

  -- Monitoring: fill in statuses for any calls logged on a previous fire.
  BEGIN
    PERFORM public.reconcile_brand_deploy_log();
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'auto_deploy_brand_template: reconcile skipped (%)', SQLERRM;
  END;

  v_anon_key := current_setting('app.settings.service_role_key', true);
  IF v_anon_key IS NULL THEN
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;
  IF v_anon_key IS NULL THEN
    RAISE LOG 'auto_deploy_brand_template: missing service_role_key';
    INSERT INTO public.brand_deploy_trigger_log (template_id, brand_id, phase, url, status_code, response_body, resolved_at)
    VALUES (NEW.id, v_brand_id, 'aborted_no_credential', v_base_url, 0, 'missing service_role_key', now());
    RETURN NEW;
  END IF;

  -- Case 1: Template just went live (deploy item to all INVENTORY-ENABLED locations)
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'live' AND NEW.status = 'live')
     OR (TG_OP = 'INSERT' AND NEW.status = 'live') THEN

    FOR v_loc IN
      SELECT l.id AS location_id
      FROM locations l
      JOIN organizations o ON o.id = l.organization_id
      WHERE o.brand_id = v_brand_id
        AND l.is_active = true
        AND l.inventory_enabled = true  -- Seals cascade-pollution class permanently
    LOOP
      -- Phase 1: structural deploy. Items land INACTIVE; no vendor calls, no pricing.
      SELECT net.http_post(
        url := v_base_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := jsonb_build_object(
          'locationId', v_loc.location_id,
          'brandId', v_brand_id,
          'templateId', NEW.id
        )
      ) INTO v_req_id;

      INSERT INTO public.brand_deploy_trigger_log (template_id, brand_id, location_id, phase, url, request_id)
      VALUES (NEW.id, v_brand_id, v_loc.location_id, 'phase1_deploy', v_base_url, v_req_id);

      -- Phase 2: activation sweep. Prices the deployed items via the shared chain and
      -- switches on the ones with a real price. Fire-and-forget like Phase 1, so there
      -- is no ordering guarantee between the two calls — acceptable because the sweep is
      -- idempotent and the nightly price_fill run is the backstop.
      SELECT net.http_post(
        url := v_chase_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := jsonb_build_object(
          'locationId', v_loc.location_id,
          'activate', true,
          'includeInactive', true
        )
      ) INTO v_req_id;

      INSERT INTO public.brand_deploy_trigger_log (template_id, brand_id, location_id, phase, url, request_id)
      VALUES (NEW.id, v_brand_id, v_loc.location_id, 'phase2_price_sweep', v_chase_url, v_req_id);
    END LOOP;
  END IF;

  -- Case 2: Recipe ingredients changed on a LIVE template -> cascade to local mirrors
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'live'
     AND NEW.recipe_ingredients IS DISTINCT FROM OLD.recipe_ingredients THEN

    FOR v_loc IN
      SELECT ii.id AS item_id, ii.location_id
      FROM inventory_items ii
      WHERE ii.brand_item_id = NEW.id
    LOOP
      DELETE FROM inventory_recipe_ingredients
      WHERE recipe_item_id = v_loc.item_id;

      INSERT INTO inventory_recipe_ingredients (recipe_item_id, ingredient_item_id, quantity, unit)
      SELECT
        v_loc.item_id,
        match.id,
        (ing->>'quantity')::numeric,
        ing->>'unit'
      FROM jsonb_array_elements(NEW.recipe_ingredients) AS ing
      CROSS JOIN LATERAL (
        SELECT ii2.id
        FROM inventory_items ii2
        WHERE ii2.location_id = v_loc.location_id
          AND (
            (ing->>'ingredient_item_number' IS NOT NULL
             AND lower(trim(ii2.item_number)) = lower(trim(ing->>'ingredient_item_number')))
            OR
            (ing->>'ingredient_pa_item_id' IS NOT NULL
             AND lower(trim(ii2.pa_item_id)) = lower(trim(ing->>'ingredient_pa_item_id')))
            OR
            (ing->>'ingredient_name' IS NOT NULL
             AND lower(ii2.name) = lower(ing->>'ingredient_name'))
          )
        ORDER BY ii2.is_active DESC
        LIMIT 1
      ) AS match;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;