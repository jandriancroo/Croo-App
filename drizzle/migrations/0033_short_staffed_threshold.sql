ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS short_staffed_threshold integer NOT NULL DEFAULT 3;
ALTER TABLE public.location_settings
  ADD CONSTRAINT location_settings_short_staffed_threshold_range CHECK (short_staffed_threshold BETWEEN 1 AND 20);

-- Managers+ (same people who manage availability) save only this one value for a store they can access.
-- location_settings write RLS stays admin-only; this narrow function is the managers' path.
CREATE OR REPLACE FUNCTION public.set_short_staffed_threshold(_location_id uuid, _threshold integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'manager')
     OR NOT public.has_location_access(auth.uid(), _location_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF _threshold IS NULL OR _threshold < 1 OR _threshold > 20 THEN
    RAISE EXCEPTION 'threshold must be 1-20' USING ERRCODE = '22023';
  END IF;
  UPDATE public.location_settings SET short_staffed_threshold = _threshold WHERE location_id = _location_id;
  IF NOT FOUND THEN
    INSERT INTO public.location_settings (location_id, short_staffed_threshold) VALUES (_location_id, _threshold);
  END IF;
  RETURN _threshold;
END $$;
REVOKE ALL ON FUNCTION public.set_short_staffed_threshold(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_short_staffed_threshold(uuid, integer) TO authenticated;