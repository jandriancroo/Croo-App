CREATE OR REPLACE FUNCTION public.end_promo_tracker_by_title(_title text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _trimmed text := btrim(coalesce(_title, ''));
  _row public.dashboard_widgets%ROWTYPE;
  _deleted integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _trimmed = '' THEN
    RETURN 0;
  END IF;

  FOR _row IN
    SELECT * FROM public.dashboard_widgets
    WHERE widget_type = 'tracker' AND title = _trimmed
  LOOP
    BEGIN
      PERFORM public._validate_widget_authority(
        _uid, _row.authority_scope,
        _row.brand_id, _row.organization_id, _row.location_id, _row.created_by
      );
      DELETE FROM public.dashboard_widgets WHERE id = _row.id;
      _deleted := _deleted + 1;
    EXCEPTION WHEN OTHERS THEN
      -- skip rows the caller isn't authorized to delete
      NULL;
    END;
  END LOOP;

  RETURN _deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_promo_tracker_by_title(text) TO authenticated;