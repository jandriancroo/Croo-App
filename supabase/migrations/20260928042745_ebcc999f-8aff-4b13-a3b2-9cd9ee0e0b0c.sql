CREATE OR REPLACE FUNCTION public.set_register_labor(_location_id uuid, _integration_type text, _on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_org uuid; v_rows int;
BEGIN
  IF _integration_type NOT IN ('qubeyond','aloha','clover') THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  SELECT organization_id INTO v_org FROM public.locations WHERE id = _location_id;
  IF v_uid IS NULL OR NOT (public.is_super_admin(v_uid) OR (v_org IS NOT NULL AND public.is_org_admin(v_uid, v_org))) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _on THEN
    SELECT count(*) INTO v_rows FROM public.labor_cache
     WHERE location_id = _location_id AND source = _integration_type
       AND labor_date >= current_date - 7 AND coalesce(labor_hours,0) > 0;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'no register labor in the last 7 days' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  UPDATE public.location_integrations
     SET credentials = coalesce(credentials, '{}'::jsonb) || jsonb_build_object('pull_labor', _on)
   WHERE location_id = _location_id AND integration_type = _integration_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'integration not found' USING ERRCODE = '22023';
  END IF;
  RETURN _on;
END;
$$;
REVOKE ALL ON FUNCTION public.set_register_labor(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_register_labor(uuid, text, boolean) TO authenticated, service_role;