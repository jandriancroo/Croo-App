CREATE OR REPLACE FUNCTION public.labor_rule_check_allowed(_location_id uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_last timestamptz;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.has_location_access(auth.uid(), _location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF _kind = 'build' THEN
    IF EXISTS (SELECT 1 FROM public.labor_rule_proposals WHERE location_id = _location_id AND status <> 'failed') THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'This store already had its setup check.', 'next_at', NULL); END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'next_at', NULL);
  ELSIF _kind = 'recheck' THEN
    SELECT max(created_at) INTO v_last FROM public.labor_rule_proposals
     WHERE location_id = _location_id AND status IN ('pending','applied','declined','no_changes','expired')
       AND created_at > now() - interval '24 hours';
    IF v_last IS NOT NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Checked in the last 24 hours.', 'next_at', v_last + interval '24 hours'); END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'next_at', NULL);
  END IF;
  RAISE EXCEPTION 'invalid kind' USING ERRCODE = '22023';
END $$;