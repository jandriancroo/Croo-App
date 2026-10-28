CREATE OR REPLACE FUNCTION public.can_edit_schedule(_uid uuid, _location_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT _uid IS NOT NULL AND _location_id IS NOT NULL
    -- No probing other people: a signed-in caller may only ask about themselves unless admin+.
    AND (auth.uid() IS NULL OR _uid = auth.uid() OR public.has_role_or_higher(auth.uid(), 'admin'))
    AND (
      (public.has_role_or_higher(_uid, 'manager') AND public.has_location_access(_uid, _location_id))
      OR (public.get_user_role(_uid) = 'scheduling_manager'::public.app_role AND public.has_location_access(_uid, _location_id))
    );
$function$;
REVOKE EXECUTE ON FUNCTION public.can_edit_schedule(uuid, uuid) FROM PUBLIC, anon;
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
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public._schedule_week_labor_check(_schedule_id);
END $function$;

CREATE OR REPLACE FUNCTION public.submit_schedule_for_approval(_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE sc record; v_appr uuid[]; v_chk jsonb; v_store text; v_name text; v_n int; v_task uuid; v_desc text;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id FOR UPDATE;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF NOT public.has_location_access(auth.uid(), sc.location_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT public.can_edit_schedule(auth.uid(), sc.location_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF coalesce(sc.is_published, false) THEN RAISE EXCEPTION 'already_published'; END IF;
  IF NOT public._schedule_approval_required(auth.uid(), sc.location_id, sc.id) THEN RAISE EXCEPTION 'approval_not_required'; END IF;
  v_appr := public._schedule_approvers(sc.location_id, auth.uid());
  IF v_appr IS NULL OR array_length(v_appr, 1) IS NULL THEN RAISE EXCEPTION 'no_approver'; END IF;

  v_chk := public.schedule_week_labor_check(_schedule_id);
  SELECT name INTO v_store FROM locations WHERE id = sc.location_id;
  SELECT coalesce(nullif(full_name, ''), 'A manager') INTO v_name FROM profiles WHERE id = auth.uid();
  SELECT count(*) INTO v_n FROM scheduled_shifts s WHERE s.schedule_id = _schedule_id AND NOT coalesce(s.is_time_off,false) AND NOT coalesce(s.is_phantom,false);
  v_desc := v_name || ' · ' || v_n || ' shifts · ' || coalesce((v_chk->>'scheduled_hours'), '0') || ' hrs · labor '
    || coalesce(v_chk->>'labor_pct', '—') || '% vs ' || coalesce(v_chk->>'target_pct', '—') || '%';

  PERFORM set_config('croo.schedule_approval', '1', true);
  UPDATE schedules SET approval_status = 'pending', approval_requested_by = auth.uid(), approval_requested_at = now(),
    approval_decided_by = NULL, approval_decided_at = NULL, approval_message = NULL
  WHERE id = _schedule_id;
  PERFORM set_config('croo.schedule_approval', '', true);

  SELECT id INTO v_task FROM temporary_tasks WHERE schedule_id = _schedule_id AND title LIKE 'Approve schedule:%' ORDER BY created_at DESC LIMIT 1;
  IF v_task IS NULL THEN
    INSERT INTO temporary_tasks (location_id, title, description, icon_name, accent_color, created_by, show_on_dashboard, schedule_id)
    VALUES (sc.location_id, 'Approve schedule: ' || coalesce(v_store, 'Store') || ', week of ' || to_char(sc.week_start_date, 'Mon FMDD'),
      v_desc, 'CalendarCheck', '#F59E0B', auth.uid(), true, _schedule_id)
    RETURNING id INTO v_task;
  ELSE
    UPDATE temporary_tasks SET description = v_desc, is_active = true, completed_at = NULL, completed_by = NULL WHERE id = v_task;
  END IF;
  DELETE FROM temporary_task_assignments WHERE task_id = v_task;
  INSERT INTO temporary_task_assignments (task_id, user_id) SELECT v_task, u FROM unnest(v_appr) u;

  UPDATE temporary_tasks SET is_active = false, completed_at = now(), completed_by = auth.uid()
  WHERE schedule_id = _schedule_id AND title LIKE 'Schedule sent back:%' AND completed_at IS NULL;

  INSERT INTO schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, source)
  VALUES (_schedule_id, 'approval_requested', auth.uid(), true, false, 'system');

  INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
  VALUES ('schedule_approval', 'schedule_approval:requested:' || _schedule_id || ':' || extract(epoch FROM clock_timestamp())::text, sc.location_id,
    jsonb_build_object('user_ids', to_jsonb(v_appr), 'title', 'Schedule needs approval', 'body', v_desc,
      'notification_type', 'schedule_updates',
      'data', jsonb_build_object('type', 'schedule_approval', 'schedule_id', _schedule_id,
        'url', '/schedule?location=' || sc.location_id || '&week=' || to_char(sc.week_start_date, 'YYYY-MM-DD'))))
  ON CONFLICT (dedup_key) DO NOTHING;

  RETURN jsonb_build_object('status', 'pending', 'task_id', v_task, 'approvers', to_jsonb(v_appr));
END $function$;

REVOKE EXECUTE ON FUNCTION public.store_blended_rate(uuid, date) FROM PUBLIC, anon, authenticated;