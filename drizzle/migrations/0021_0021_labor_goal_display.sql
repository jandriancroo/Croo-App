-- Ship "Overlay goal": one resolver, gated readers.
-- Verify: SELECT proname, proacl FROM pg_proc WHERE proname IN ('_labor_goals_resolve','labor_goal_display','labor_goals');
-- Rollback: CREATE OR REPLACE labor_goals back to the 0016 body (caller check + inline math); new functions may stay unused.
CREATE OR REPLACE FUNCTION public._labor_goals_resolve(_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE t record; store_default numeric; days jsonb := '{}'::jsonb; i int;
BEGIN
  SELECT labor_percentage_target INTO store_default FROM public.location_settings WHERE location_id = _location_id;
  store_default := coalesce(store_default, 25);
  SELECT id, template_name, weekly_labor_percentage_target INTO t
    FROM public.week_templates WHERE location_id = _location_id AND is_store_goal;
  FOR i IN 0..6 LOOP
    days := days || jsonb_build_object(i::text, (SELECT ds.labor_percentage_target FROM public.week_template_day_settings ds
      WHERE ds.week_template_id = t.id AND ds.day_of_week = i));
  END LOOP;
  RETURN jsonb_build_object(
    'weekly', coalesce(t.weekly_labor_percentage_target, store_default),
    'weekly_source', CASE WHEN t.weekly_labor_percentage_target IS NOT NULL THEN 'weekly_goal' ELSE 'store_default' END,
    'store_default', store_default,
    'days', days, 'template_id', t.id, 'template_name', t.template_name);
END $function$;
REVOKE EXECUTE ON FUNCTION public._labor_goals_resolve(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_goals_resolve(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.labor_goals(_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NOT public._labor_goal_caller_ok(_location_id) THEN RETURN NULL; END IF;
  RETURN public._labor_goals_resolve(_location_id);
END $function$;

CREATE OR REPLACE FUNCTION public.labor_goal_display(_location_id uuid, _date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE g jsonb; d jsonb;
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND public.is_punch_device(auth.uid()) AND public.punch_device_location(auth.uid()) = _location_id)
    OR (auth.uid() IS NOT NULL AND public.has_role_or_higher(auth.uid(), 'shift_manager') AND public.has_location_access(auth.uid(), _location_id))
  ) THEN RETURN NULL; END IF;
  g := public._labor_goals_resolve(_location_id);
  IF _date IS NOT NULL THEN
    d := g->'days'->((extract(isodow FROM _date)::int - 1)::text);
    IF d = 'null'::jsonb THEN d := NULL; END IF;
  END IF;
  RETURN jsonb_build_object('day', d, 'weekly', g->'weekly');
END $function$;
REVOKE EXECUTE ON FUNCTION public.labor_goal_display(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_goal_display(uuid, date) TO authenticated, service_role;