CREATE OR REPLACE FUNCTION public._labor_goal_caller_ok(_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR (auth.uid() IS NOT NULL AND public.has_location_access(auth.uid(), _location_id))
$$;
REVOKE EXECUTE ON FUNCTION public._labor_goal_caller_ok(uuid) FROM PUBLIC, anon, authenticated;