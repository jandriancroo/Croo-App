
-- RPC for atomic gap upsert with location merge
CREATE OR REPLACE FUNCTION public.upsert_vendor_gap_with_location(
  _brand_id uuid,
  _vendor_source text,
  _item_number text,
  _vendor_name text,
  _vendor_description text,
  _pack_size text,
  _category_name text,
  _location_id uuid,
  _location_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _alert_id uuid;
  _existing_locs jsonb;
  _new_loc jsonb;
BEGIN
  _new_loc := jsonb_build_object('id', _location_id::text, 'name', COALESCE(_location_name, 'Unknown'));

  INSERT INTO vendor_gap_alerts (
    brand_id, vendor_source, item_number, vendor_name,
    vendor_description, pack_size, category_name, status, reported_by_locations
  )
  VALUES (
    _brand_id, _vendor_source, _item_number, _vendor_name,
    _vendor_description, _pack_size, _category_name, 'new',
    CASE WHEN _location_id IS NOT NULL THEN jsonb_build_array(_new_loc) ELSE '[]'::jsonb END
  )
  ON CONFLICT (brand_id, vendor_source, item_number)
  DO UPDATE SET
    vendor_name = COALESCE(EXCLUDED.vendor_name, vendor_gap_alerts.vendor_name),
    vendor_description = COALESCE(EXCLUDED.vendor_description, vendor_gap_alerts.vendor_description),
    pack_size = COALESCE(EXCLUDED.pack_size, vendor_gap_alerts.pack_size),
    category_name = COALESCE(EXCLUDED.category_name, vendor_gap_alerts.category_name)
  RETURNING id, reported_by_locations INTO _alert_id, _existing_locs;

  -- Append location if not already present (dedup by id)
  IF _location_id IS NOT NULL AND NOT (_existing_locs @> jsonb_build_array(jsonb_build_object('id', _location_id::text))) THEN
    UPDATE vendor_gap_alerts
    SET reported_by_locations = COALESCE(reported_by_locations, '[]'::jsonb) || _new_loc
    WHERE id = _alert_id;
  END IF;

  RETURN _alert_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_vendor_gap_with_location TO authenticated, service_role;
