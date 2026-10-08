CREATE OR REPLACE FUNCTION public._osc_caller_ok(_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.has_role_or_higher(auth.uid(), 'manager')
    AND public.has_location_access(auth.uid(), _location_id)
$$;
REVOKE EXECUTE ON FUNCTION public._osc_caller_ok(uuid) FROM PUBLIC, anon, authenticated;
DO $d$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.original_shift_changes(uuid,date,date,uuid)'::regprocedure) INTO src;
  src := replace(src,
    $$IF auth.uid() IS NULL
     OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
     OR NOT public.has_location_access(auth.uid(), _location_id) THEN$$,
    $$IF NOT public._osc_caller_ok(_location_id) THEN$$);
  IF position('_osc_caller_ok' in src) = 0 THEN RAISE EXCEPTION 'gate replace failed'; END IF;
  EXECUTE src;
END $d$;