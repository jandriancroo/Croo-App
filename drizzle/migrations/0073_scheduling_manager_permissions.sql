-- Role ranking: give scheduling_manager a rank (below shift managers, above team members). Other roles keep their order.
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY
    CASE role
      WHEN 'super_admin' THEN 0
      WHEN 'brand_admin' THEN 1
      WHEN 'org_admin' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'manager' THEN 4
      WHEN 'general_manager' THEN 4
      WHEN 'shift_manager' THEN 5
      WHEN 'shift_manager_in_training' THEN 6
      WHEN 'scheduling_manager' THEN 7
      WHEN 'team_member' THEN 8
    END
  LIMIT 1
$function$;

-- 2) Approval roles may include scheduling_manager
ALTER TABLE public.location_settings DROP CONSTRAINT IF EXISTS location_settings_schedule_approval_roles_chk;
ALTER TABLE public.location_settings ADD CONSTRAINT location_settings_schedule_approval_roles_chk
  CHECK (schedule_approval_roles <@ ARRAY['manager'::app_role, 'admin'::app_role, 'scheduling_manager'::app_role]);

CREATE OR REPLACE FUNCTION public.set_schedule_approval_settings(_location_id uuid, _enabled boolean DEFAULT NULL::boolean, _roles app_role[] DEFAULT NULL::app_role[], _mode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ls record; v_enabled boolean; v_roles public.app_role[]; v_mode text; v_appr uuid[];
BEGIN
  IF NOT (public.has_role_or_higher(auth.uid(), 'admin') AND public.has_location_access(auth.uid(), _location_id)) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO ls FROM location_settings WHERE location_id = _location_id FOR UPDATE;
  IF ls IS NULL THEN RAISE EXCEPTION 'location_settings_not_found'; END IF;
  v_enabled := coalesce(_enabled, ls.schedule_approval_enabled);
  v_roles := coalesce(_roles, ls.schedule_approval_roles);
  v_mode := coalesce(_mode, ls.schedule_approval_mode);
  IF array_length(v_roles, 1) IS NULL OR NOT (v_roles <@ ARRAY['manager','admin','scheduling_manager']::public.app_role[]) THEN RAISE EXCEPTION 'invalid_roles'; END IF;
  IF v_mode NOT IN ('every_draft','over_labor_goal') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  IF public.get_user_role(auth.uid()) = ANY(v_roles) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE location_settings SET schedule_approval_enabled = v_enabled, schedule_approval_roles = v_roles, schedule_approval_mode = v_mode, updated_at = now()
  WHERE location_id = _location_id;

  IF NOT v_enabled THEN
    UPDATE temporary_tasks t SET is_active = false, completed_at = now(), completed_by = auth.uid()
    FROM schedules s WHERE t.schedule_id = s.id AND s.location_id = _location_id
      AND s.approval_status IN ('pending','changes_requested') AND t.completed_at IS NULL;
    PERFORM set_config('croo.schedule_approval', '1', true);
    UPDATE schedules SET approval_status = NULL, approval_requested_by = NULL, approval_requested_at = NULL,
      approval_decided_by = NULL, approval_decided_at = NULL, approval_message = NULL
    WHERE location_id = _location_id AND approval_status IN ('pending','changes_requested');
    PERFORM set_config('croo.schedule_approval', '', true);
  END IF;

  v_appr := public._schedule_approvers(_location_id, NULL);
  IF v_enabled AND (v_appr IS NULL OR array_length(v_appr, 1) IS NULL) THEN
    RAISE NOTICE 'no_approver: nobody at this store can approve schedules';
  END IF;
  RETURN jsonb_build_object('enabled', v_enabled, 'roles', to_jsonb(v_roles), 'mode', v_mode,
    'no_approver', v_enabled AND (v_appr IS NULL OR array_length(v_appr, 1) IS NULL));
END $function$;

-- 3) Schedule edit gate
CREATE OR REPLACE FUNCTION public.can_edit_schedule(_uid uuid, _location_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT _uid IS NOT NULL AND _location_id IS NOT NULL AND (
    (public.has_role_or_higher(_uid, 'manager') AND public.has_location_access(_uid, _location_id))
    OR (public.get_user_role(_uid) = 'scheduling_manager'::public.app_role AND public.has_location_access(_uid, _location_id))
  );
$function$;
GRANT EXECUTE ON FUNCTION public.can_edit_schedule(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_schedule(_schedule_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE sc record;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF NOT public.can_edit_schedule(auth.uid(), sc.location_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public._schedule_approval_required(auth.uid(), sc.location_id, sc.id) THEN RAISE EXCEPTION 'approval_required'; END IF;
  RETURN public._publish_schedule(_schedule_id, auth.uid());
END $function$;

CREATE OR REPLACE FUNCTION public.schedule_week_labor_check(_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_loc uuid;
BEGIN
  SELECT location_id INTO v_loc FROM schedules WHERE id = _schedule_id;
  IF v_loc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_edit_schedule(auth.uid(), v_loc) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN public._schedule_week_labor_check(_schedule_id);
END $function$;

-- RLS: additional permissive policies for scheduling_manager only (existing policies untouched)
CREATE POLICY "Scheduling managers can insert schedules" ON public.schedules FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND public.can_edit_schedule(auth.uid(), location_id));
CREATE POLICY "Scheduling managers can update schedules" ON public.schedules FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND public.can_edit_schedule(auth.uid(), location_id))
  WITH CHECK (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND public.can_edit_schedule(auth.uid(), location_id));
CREATE POLICY "Scheduling managers can delete schedules" ON public.schedules FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND public.can_edit_schedule(auth.uid(), location_id));

CREATE POLICY "Scheduling managers can insert shifts" ON public.scheduled_shifts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND schedule_id IS NOT NULL
    AND public.can_edit_schedule(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = scheduled_shifts.schedule_id)));
CREATE POLICY "Scheduling managers can update shifts" ON public.scheduled_shifts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND schedule_id IS NOT NULL
    AND public.can_edit_schedule(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = scheduled_shifts.schedule_id)))
  WITH CHECK (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND schedule_id IS NOT NULL
    AND public.can_edit_schedule(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = scheduled_shifts.schedule_id)));
CREATE POLICY "Scheduling managers can delete shifts" ON public.scheduled_shifts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'scheduling_manager'::app_role) AND schedule_id IS NOT NULL
    AND public.can_edit_schedule(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = scheduled_shifts.schedule_id)));

-- 4) Store blended rate
CREATE OR REPLACE FUNCTION public.store_blended_rate(_location_id uuid, _date date DEFAULT CURRENT_DATE)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(round(avg(w.wage), 2), 15.00)
  FROM (
    SELECT coalesce(
      (SELECT wh.hourly_wage FROM public.wage_history wh
        WHERE wh.user_id = ul.user_id AND wh.effective_date <= coalesce(_date, CURRENT_DATE)
        ORDER BY wh.effective_date DESC LIMIT 1),
      p.hourly_wage) AS wage
    FROM (SELECT DISTINCT user_id FROM public.user_locations WHERE location_id = _location_id) ul
    JOIN public.profiles p ON p.id = ul.user_id AND coalesce(p.is_active, true)
  ) w
  WHERE w.wage IS NOT NULL AND w.wage > 0;
$function$;
COMMENT ON FUNCTION public.store_blended_rate(uuid, date) IS
  'Store blended hourly rate: average current hourly wage (latest wage_history row effective on/before _date, else profiles.hourly_wage) of active staff assigned to the location via user_locations, ignoring null/0 wages, rounded to 2 decimals; 15.00 when none. Internal only: used by definer functions to show scheduling_manager costs without individual wages.';
REVOKE EXECUTE ON FUNCTION public.store_blended_rate(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_blended_rate(uuid, date) TO service_role;

-- 5) Wage readers
DROP FUNCTION IF EXISTS public.get_current_wage(uuid, date);
CREATE FUNCTION public.get_current_wage(p_user_id uuid, p_date date DEFAULT CURRENT_DATE, _location_id uuid DEFAULT NULL)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_wage numeric; v_loc uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id
     AND public.get_user_role(auth.uid()) = 'scheduling_manager'::public.app_role THEN
    v_loc := coalesce(_location_id,
      (SELECT ul.location_id FROM public.user_locations ul WHERE ul.user_id = auth.uid() ORDER BY ul.created_at, ul.id LIMIT 1));
    IF v_loc IS NULL OR NOT public.has_location_access(auth.uid(), v_loc) THEN RETURN 15.00; END IF;
    RETURN public.store_blended_rate(v_loc, p_date);
  END IF;
  IF auth.uid() IS NULL OR (auth.uid() <> p_user_id AND NOT public.has_role_or_higher(auth.uid(), 'manager')) THEN
    RETURN 15.00;
  END IF;
  SELECT hourly_wage INTO v_wage FROM public.wage_history
   WHERE user_id = p_user_id AND effective_date <= p_date
   ORDER BY effective_date DESC LIMIT 1;
  IF v_wage IS NULL THEN
    SELECT hourly_wage INTO v_wage FROM public.profiles WHERE id = p_user_id;
  END IF;
  RETURN COALESCE(v_wage, 15.00);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_current_wage(uuid, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_wage(uuid, date, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_current_wages_batch(uuid[], date);
CREATE FUNCTION public.get_current_wages_batch(p_user_ids uuid[], p_date date DEFAULT CURRENT_DATE, _location_id uuid DEFAULT NULL)
 RETURNS TABLE(user_id uuid, hourly_wage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_privileged boolean; v_sm boolean; v_loc uuid; v_blend numeric := 15.00;
BEGIN
  v_privileged := auth.uid() IS NOT NULL AND public.has_role_or_higher(auth.uid(), 'manager');
  v_sm := auth.uid() IS NOT NULL AND NOT v_privileged
          AND public.get_user_role(auth.uid()) = 'scheduling_manager'::public.app_role;
  IF v_sm THEN
    v_loc := coalesce(_location_id,
      (SELECT ul.location_id FROM public.user_locations ul WHERE ul.user_id = auth.uid() ORDER BY ul.created_at, ul.id LIMIT 1));
    IF v_loc IS NOT NULL AND public.has_location_access(auth.uid(), v_loc) THEN
      v_blend := public.store_blended_rate(v_loc, p_date);
    END IF;
  END IF;
  RETURN QUERY
  SELECT
    u.id AS user_id,
    CASE WHEN v_privileged OR u.id = auth.uid() THEN
      COALESCE(
        (SELECT wh.hourly_wage FROM wage_history wh
          WHERE wh.user_id = u.id AND wh.effective_date <= p_date
          ORDER BY wh.effective_date DESC LIMIT 1),
        p.hourly_wage, 15.00)
    WHEN v_sm THEN v_blend
    ELSE 15.00 END AS hourly_wage
  FROM unnest(p_user_ids) AS u(id)
  LEFT JOIN profiles p ON p.id = u.id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_current_wages_batch(uuid[], date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_wages_batch(uuid[], date, uuid) TO authenticated, service_role;

-- 6) Week labor check: blended cost for scheduling_manager
CREATE OR REPLACE FUNCTION public._schedule_week_labor_check(_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE sc record; v_rules jsonb; v_pay jsonb; v_hours numeric := 0; v_cost numeric := 0; v_sales numeric;
  v_target numeric; v_pct numeric; v_reason text; v_days jsonb; v_people jsonb; v_any_day boolean;
  v_ot numeric; v_wk numeric; v_sm boolean;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;

  v_sm := auth.uid() IS NOT NULL AND NOT public.has_role_or_higher(auth.uid(), 'manager')
          AND public.get_user_role(auth.uid()) = 'scheduling_manager'::public.app_role;

  SELECT to_jsonb(lr) INTO v_rules FROM labor_rules lr WHERE lr.location_id = sc.location_id;
  v_ot := coalesce((v_rules->>'daily_overtime_threshold')::numeric, 0);
  v_wk := nullif((v_rules->>'weekly_overtime_threshold')::numeric, 0);

  v_target := public.labor_goal_pct(sc.location_id, NULL);
  IF v_target IS NULL THEN
    SELECT labor_percentage_target INTO v_target FROM location_settings WHERE location_id = sc.location_id;
  END IF;

  SELECT public.labor_week_pay(coalesce(jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'shift_date', s.shift_date, 'start_time', s.start_time, 'end_time', s.end_time,
      'wage', CASE WHEN v_sm THEN public.store_blended_rate(sc.location_id, s.shift_date)
              ELSE coalesce((SELECT wh.hourly_wage FROM wage_history wh
                         WHERE wh.user_id = s.user_id AND wh.effective_date <= s.shift_date
                         ORDER BY wh.effective_date DESC LIMIT 1), pr.hourly_wage, 15) END)), '[]'::jsonb), v_rules)
  INTO v_pay
  FROM scheduled_shifts s LEFT JOIN profiles pr ON pr.id = s.user_id
  WHERE s.schedule_id = _schedule_id AND s.user_id IS NOT NULL
    AND NOT coalesce(s.is_time_off, false) AND NOT coalesce(s.is_phantom, false);

  WITH d AS (
    SELECT g::date AS day, (g::date - sc.week_start_date) AS idx
    FROM generate_series(sc.week_start_date, sc.week_start_date + 6, interval '1 day') g
  ), p AS (
    SELECT DISTINCT ON (c.sale_date) c.sale_date,
      coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) AS proj
    FROM sales_cache c WHERE c.location_id = sc.location_id AND c.sale_date BETWEEN sc.week_start_date AND sc.week_start_date + 6
    ORDER BY c.sale_date, coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) DESC NULLS LAST
  ), dl AS (
    SELECT (x->>'date')::date AS day, (x->>'hours')::numeric AS hrs, (x->>'cost')::numeric AS cost
    FROM jsonb_array_elements(v_pay->'days') x
  ), dd AS (
    SELECT d.day, coalesce(sps.projected_sales, p.proj) AS sales,
      coalesce(dl.hrs, 0) AS hrs, coalesce(dl.cost, 0) AS cost,
      coalesce(public.labor_goal_pct(sc.location_id, d.day), v_target) AS target
    FROM d LEFT JOIN p ON p.sale_date = d.day
      LEFT JOIN schedule_projected_sales sps ON sps.schedule_id = _schedule_id AND sps.day_of_week = d.idx
      LEFT JOIN dl ON dl.day = d.day
  ), dp AS (
    SELECT dd.*, CASE WHEN dd.sales > 0 THEN round(dd.cost / dd.sales * 100, 1) END AS pct FROM dd
  )
  SELECT coalesce(sum(hrs), 0), coalesce(sum(cost), 0), sum(sales),
    jsonb_agg(jsonb_build_object('date', day, 'projected_sales', sales, 'target_pct', target,
        'scheduled_hours', round(hrs, 2), 'scheduled_cost', round(cost, 2), 'labor_pct', pct,
        'over_goal', coalesce(pct > target, false)) ORDER BY day),
    coalesce(bool_or(pct > target), false)
  INTO v_hours, v_cost, v_sales, v_days, v_any_day
  FROM dp;

  SELECT coalesce(jsonb_agg(o ORDER BY o->>'name'), '[]'::jsonb) INTO v_people FROM (
    SELECT jsonb_build_object('user_id', pp->>'user_id', 'name', pr.full_name,
      'week_hours', round((pp->>'week_hours')::numeric, 2),
      'over_weekly', coalesce(v_wk IS NOT NULL AND (pp->>'week_hours')::numeric > v_wk, false),
      'weekly_threshold', v_wk,
      'days_over_daily', coalesce((SELECT jsonb_agg(jsonb_build_object('date', dy->>'date', 'hours', round((dy->>'hours')::numeric, 2)) ORDER BY dy->>'date')
          FROM jsonb_array_elements(pp->'days') dy WHERE v_ot > 0 AND (dy->>'hours')::numeric > v_ot), '[]'::jsonb),
      'seventh_day', (SELECT dy->>'date' FROM jsonb_array_elements(pp->'days') dy WHERE (dy->>'seventh_day')::boolean LIMIT 1)) AS o
    FROM jsonb_array_elements(v_pay->'people') pp LEFT JOIN profiles pr ON pr.id = (pp->>'user_id')::uuid
  ) q
  WHERE (o->>'over_weekly')::boolean OR jsonb_array_length(o->'days_over_daily') > 0
     OR o->>'seventh_day' IS NOT NULL;

  IF v_sales IS NOT NULL AND v_sales > 0 THEN v_pct := round(v_cost / v_sales * 100, 1); END IF;
  IF v_target IS NULL THEN v_reason := 'no_target';
  ELSIF v_sales IS NULL THEN v_reason := 'no_projection';
  ELSIF v_sales <= 0 THEN v_reason := 'zero_sales';
  ELSIF v_pct > v_target THEN v_reason := 'over_goal';
  ELSIF v_any_day THEN v_reason := 'day_over_goal';
  END IF;

  RETURN jsonb_build_object('scheduled_hours', round(v_hours, 2), 'scheduled_cost', round(v_cost, 2),
    'projected_sales', round(v_sales, 2), 'labor_pct', v_pct, 'target_pct', v_target,
    'misses_goal', v_reason IS NOT NULL, 'reason', v_reason,
    'week_over_goal', coalesce(v_pct > v_target, false),
    'days', coalesce(v_days, '[]'::jsonb), 'people', v_people);
END $function$;

-- 7) Re-assert wage column revokes
REVOKE SELECT (hourly_wage) ON public.profiles FROM anon, authenticated;
REVOKE SELECT (employee_breakdown) ON public.labor_cache FROM anon, authenticated;