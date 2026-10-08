CREATE OR REPLACE FUNCTION public._labor_goal_caller_ok(_location_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR (auth.uid() IS NOT NULL
          AND public.has_role_or_higher(auth.uid(), 'manager')
          AND public.has_location_access(auth.uid(), _location_id))
$function$;

CREATE OR REPLACE FUNCTION public._can_edit_schedule(_user uuid, _location_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT _user IS NOT NULL
     AND public.has_role_or_higher(_user, 'manager')
     AND public.has_location_access(_user, _location_id);
$function$;

REVOKE EXECUTE ON FUNCTION public._labor_goal_caller_ok(uuid), public._can_edit_schedule(uuid,uuid),
  public._invert_log_rows(jsonb, public.schedule_change_log[]), public._shift_cmp(jsonb) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public._labor_goal_caller_ok(uuid), public._can_edit_schedule(uuid,uuid),
  public._invert_log_rows(jsonb, public.schedule_change_log[]), public._shift_cmp(jsonb) TO service_role;