CREATE OR REPLACE FUNCTION public.end_promo_tracker_by_title(_title text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _trimmed text := btrim(coalesce(_title, ''));
  _row public.dashboard_widgets%ROWTYPE;
  _row_brand uuid;
  _deleted integer := 0;
  _is_super boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _trimmed = '' THEN
    RETURN 0;
  END IF;

  _is_super := public.is_super_admin(_uid);

  FOR _row IN
    SELECT * FROM public.dashboard_widgets
    WHERE widget_type = 'tracker' AND title = _trimmed
  LOOP
    -- Resolve effective brand for this row (rows fanned per-location often have brand_id null)
    _row_brand := _row.brand_id;
    IF _row_brand IS NULL AND _row.location_id IS NOT NULL THEN
      SELECT brand_id INTO _row_brand FROM public.locations WHERE id = _row.location_id;
    END IF;

    IF _is_super
       OR (_row_brand IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.brand_members
            WHERE user_id = _uid AND brand_id = _row_brand AND brand_role = 'admin'
          ))
       OR _row.created_by = _uid
    THEN
      DELETE FROM public.dashboard_widgets WHERE id = _row.id;
      _deleted := _deleted + 1;
    END IF;
  END LOOP;

  RETURN _deleted;
END;
$function$;