
CREATE OR REPLACE FUNCTION public.convert_recipe_unit_to_count(p_recipe_unit TEXT, p_count_unit TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ru TEXT;
  cu TEXT;
  oz_value NUMERIC;
  extracted_oz NUMERIC;
  extracted_lb NUMERIC;
  extracted_ml NUMERIC;
BEGIN
  ru := lower(trim(p_recipe_unit));
  cu := lower(trim(COALESCE(p_count_unit, 'oz')));

  -- If count_unit is 'ea', most recipe units map 1:1 for "Each", "CT", bottles, cans, packs
  IF cu = 'ea' THEN
    CASE
      WHEN ru IN ('each', 'ct') THEN RETURN 1.0;
      WHEN ru LIKE 'bottle%' THEN RETURN 1.0;
      WHEN ru LIKE 'can%' OR ru = 'cn' THEN RETURN 1.0;
      WHEN ru LIKE 'pack%' THEN RETURN 1.0;
      WHEN ru LIKE '#10 can%' THEN RETURN 1.0;
      WHEN ru LIKE 'case%' THEN
        RETURN NULL;
      ELSE RETURN 1.0;
    END CASE;
  END IF;

  -- For count_unit = 'oz' (most common), normalize recipe unit to oz
  IF cu = 'oz' THEN
    IF ru IN ('oz-wt', 'oz-fl', 'oz') THEN RETURN 1.0; END IF;
    IF ru = 'gram' THEN RETURN 0.035274; END IF;
    IF ru = 'lb' THEN RETURN 16.0; END IF;
    IF ru IN ('gallon', 'gal') THEN RETURN 128.0; END IF;
    IF ru = 'half gallon' THEN RETURN 64.0; END IF;
    IF ru = 'quart' THEN RETURN 32.0; END IF;
    IF ru IN ('each', 'ct') THEN RETURN NULL; END IF;

    -- "cn" = #10 can = 106 oz
    IF ru = 'cn' THEN RETURN 106.0; END IF;

    IF ru LIKE 'case%' THEN
      extracted_lb := substring(ru FROM '(\d+\.?\d*)\s*lb')::NUMERIC;
      IF extracted_lb IS NOT NULL THEN RETURN extracted_lb * 16.0; END IF;
      RETURN NULL;
    END IF;

    IF ru LIKE 'pack%' THEN
      extracted_oz := substring(ru FROM '(\d+\.?\d*)\s*oz')::NUMERIC;
      IF extracted_oz IS NOT NULL THEN RETURN extracted_oz; END IF;
      extracted_lb := substring(ru FROM '(\d+\.?\d*)\s*lb')::NUMERIC;
      IF extracted_lb IS NOT NULL THEN RETURN extracted_lb * 16.0; END IF;
      RETURN NULL;
    END IF;

    IF ru LIKE 'bottle%' THEN
      extracted_oz := substring(ru FROM '(\d+\.?\d*)\s*oz')::NUMERIC;
      IF extracted_oz IS NOT NULL THEN RETURN extracted_oz; END IF;
      extracted_ml := substring(ru FROM '(\d+\.?\d*)\s*ml')::NUMERIC;
      IF extracted_ml IS NOT NULL THEN RETURN extracted_ml * 0.033814; END IF;
      RETURN NULL;
    END IF;

    IF ru LIKE 'can%' THEN
      extracted_oz := substring(ru FROM '(\d+\.?\d*)\s*oz')::NUMERIC;
      IF extracted_oz IS NOT NULL THEN RETURN extracted_oz; END IF;
      RETURN NULL;
    END IF;

    IF ru = '#10 can' THEN RETURN 106.0; END IF;

    RETURN NULL;
  END IF;

  -- For count_unit = 'gal'
  IF cu = 'gal' THEN
    IF ru IN ('gallon', 'gal') THEN RETURN 1.0; END IF;
    IF ru = 'half gallon' THEN RETURN 0.5; END IF;
    IF ru = 'quart' THEN RETURN 0.25; END IF;
    IF ru IN ('oz-wt', 'oz-fl', 'oz') THEN RETURN 1.0 / 128.0; END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$function$;
