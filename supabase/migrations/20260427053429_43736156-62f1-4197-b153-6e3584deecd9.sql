
-- ============================================================
-- STEP 1: Wipe pan_sizes from ALL inventory_items (clean slate)
-- ============================================================
UPDATE public.inventory_items
SET pan_sizes = NULL,
    updated_at = now()
WHERE pan_sizes IS NOT NULL;

-- ============================================================
-- STEP 2: Helper function — build pan_sizes JSON from a brand template row
-- ============================================================
CREATE OR REPLACE FUNCTION public.build_pan_sizes_from_template(
  _baseline_key text,
  _enabled_keys text[],
  _units_per_unit numeric,
  _units_per_lb numeric,
  _overrides jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  baseline_units numeric;
  result jsonb;
BEGIN
  -- No baseline set → no pan config
  IF _baseline_key IS NULL THEN
    RETURN NULL;
  END IF;

  -- Baseline units = whichever yield is set (per_unit takes precedence)
  baseline_units := COALESCE(_units_per_unit, _units_per_lb);

  result := jsonb_build_object(
    'enabled', true,
    'baseline_key', _baseline_key,
    'baseline_units', COALESCE(baseline_units, 1),
    'enabled_keys', COALESCE(to_jsonb(_enabled_keys), jsonb_build_array(_baseline_key))
  );

  -- Attach per-pan numeric overrides if any
  IF _overrides IS NOT NULL AND _overrides::text NOT IN ('null', '{}') THEN
    result := result || jsonb_build_object('overrides', _overrides);
  END IF;

  RETURN result;
END;
$$;

-- ============================================================
-- STEP 3: Backfill inventory_items.pan_sizes from linked brand templates
-- ============================================================
UPDATE public.inventory_items ii
SET pan_sizes = public.build_pan_sizes_from_template(
      bt.pan_baseline_key,
      bt.pan_enabled_keys,
      bt.pan_units_per_unit,
      bt.pan_units_per_lb,
      bt.pan_overrides
    ),
    updated_at = now()
FROM public.brand_inventory_templates bt
WHERE ii.brand_item_id = bt.id
  AND bt.pan_baseline_key IS NOT NULL
  AND ii.is_active = true;

-- ============================================================
-- STEP 4: Trigger — auto-propagate brand template pan changes to all locations
-- ============================================================
CREATE OR REPLACE FUNCTION public.propagate_pan_sizes_to_locations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act if any pan-related field actually changed
  IF (TG_OP = 'UPDATE') AND (
    NEW.pan_baseline_key IS NOT DISTINCT FROM OLD.pan_baseline_key AND
    NEW.pan_enabled_keys IS NOT DISTINCT FROM OLD.pan_enabled_keys AND
    NEW.pan_units_per_unit IS NOT DISTINCT FROM OLD.pan_units_per_unit AND
    NEW.pan_units_per_lb IS NOT DISTINCT FROM OLD.pan_units_per_lb AND
    NEW.pan_overrides IS NOT DISTINCT FROM OLD.pan_overrides
  ) THEN
    RETURN NEW;
  END IF;

  -- Push the new pan config to every linked active inventory_item
  UPDATE public.inventory_items
  SET pan_sizes = public.build_pan_sizes_from_template(
        NEW.pan_baseline_key,
        NEW.pan_enabled_keys,
        NEW.pan_units_per_unit,
        NEW.pan_units_per_lb,
        NEW.pan_overrides
      ),
      updated_at = now()
  WHERE brand_item_id = NEW.id
    AND is_active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_pan_sizes ON public.brand_inventory_templates;

CREATE TRIGGER trg_propagate_pan_sizes
AFTER UPDATE ON public.brand_inventory_templates
FOR EACH ROW
EXECUTE FUNCTION public.propagate_pan_sizes_to_locations();
