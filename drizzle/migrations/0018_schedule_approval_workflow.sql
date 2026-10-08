ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS schedule_approval_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_approval_roles public.app_role[] NOT NULL DEFAULT '{manager}',
  ADD COLUMN IF NOT EXISTS schedule_approval_mode text NOT NULL DEFAULT 'every_draft';
ALTER TABLE public.location_settings
  ADD CONSTRAINT location_settings_schedule_approval_mode_chk CHECK (schedule_approval_mode IN ('every_draft','over_labor_goal')),
  ADD CONSTRAINT location_settings_schedule_approval_roles_chk CHECK (schedule_approval_roles <@ ARRAY['manager','admin']::public.app_role[]);

ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_requested_by uuid,
  ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_decided_by uuid,
  ADD COLUMN IF NOT EXISTS approval_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_message text;
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_approval_status_chk CHECK (approval_status IN ('pending','changes_requested','approved'));

ALTER TABLE public.temporary_tasks
  ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES public.schedules(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_temporary_tasks_schedule_id ON public.temporary_tasks (schedule_id) WHERE schedule_id IS NOT NULL;

-- Labor check for a week (before overtime)
CREATE OR REPLACE FUNCTION public.schedule_week_labor_check(_schedule_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sc record; v_hours numeric := 0; v_cost numeric := 0; v_sales numeric; v_target numeric;
  v_pct numeric; v_reason text; v_days jsonb;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF auth.uid() IS NOT NULL AND NOT (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), sc.location_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH sh AS (
    SELECT s.user_id, s.shift_date,
      extract(epoch FROM (CASE WHEN s.end_time <= s.start_time THEN s.end_time - s.start_time + interval '24 hours' ELSE s.end_time - s.start_time END)) / 3600.0 AS hrs
    FROM scheduled_shifts s WHERE s.schedule_id = _schedule_id AND NOT coalesce(s.is_time_off,false) AND NOT coalesce(s.is_phantom,false)
  ), w AS (
    SELECT * FROM public.get_current_wages_batch((SELECT array_agg(DISTINCT user_id) FROM sh WHERE user_id IS NOT NULL), sc.week_start_date)
  )
  SELECT coalesce(sum(sh.hrs),0), coalesce(sum(sh.hrs * coalesce(w.hourly_wage, 15)),0)
    INTO v_hours, v_cost FROM sh LEFT JOIN w ON w.user_id = sh.user_id;

  WITH d AS (
    SELECT g::date AS day FROM generate_series(sc.week_start_date, sc.week_start_date + 6, interval '1 day') g
  ), p AS (
    SELECT DISTINCT ON (c.sale_date) c.sale_date,
      coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) AS proj
    FROM sales_cache c WHERE c.location_id = sc.location_id AND c.sale_date BETWEEN sc.week_start_date AND sc.week_start_date + 6
    ORDER BY c.sale_date, coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) DESC NULLS LAST
  )
  SELECT sum(p.proj), jsonb_agg(jsonb_build_object('date', d.day, 'projected_sales', p.proj, 'target_pct', public.labor_goal_pct(sc.location_id, d.day)) ORDER BY d.day)
    INTO v_sales, v_days FROM d LEFT JOIN p ON p.sale_date = d.day;

  v_target := public.labor_goal_pct(sc.location_id, NULL);
  IF v_target IS NULL THEN
    SELECT labor_percentage_target INTO v_target FROM location_settings WHERE location_id = sc.location_id;
  END IF;

  IF v_sales IS NOT NULL AND v_sales > 0 THEN v_pct := round(v_cost / v_sales * 100, 1); END IF;
  IF v_target IS NULL THEN v_reason := 'no_target';
  ELSIF v_sales IS NULL THEN v_reason := 'no_projection';
  ELSIF v_sales <= 0 THEN v_reason := 'zero_sales';
  ELSIF v_pct > v_target THEN v_reason := 'over_goal';
  END IF;

  RETURN jsonb_build_object('scheduled_hours', round(v_hours, 2), 'scheduled_cost', round(v_cost, 2),
    'projected_sales', round(v_sales, 2), 'labor_pct', v_pct, 'target_pct', v_target,
    'misses_goal', v_reason IS NOT NULL, 'reason', v_reason, 'days', coalesce(v_days, '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public._schedule_approval_required(_user uuid, _location uuid, _schedule uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ls record;
BEGIN
  SELECT schedule_approval_enabled, schedule_approval_roles, schedule_approval_mode INTO ls FROM location_settings WHERE location_id = _location;
  IF ls IS NULL OR NOT ls.schedule_approval_enabled THEN RETURN false; END IF;
  IF _user IS NULL OR NOT (public.get_user_role(_user) = ANY(ls.schedule_approval_roles)) THEN RETURN false; END IF;
  IF ls.schedule_approval_mode = 'every_draft' THEN RETURN true; END IF;
  RETURN coalesce((public.schedule_week_labor_check(_schedule)->>'misses_goal')::boolean, true);
END $$;

CREATE OR REPLACE FUNCTION public._schedule_approvers(_location uuid, _exclude uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ls AS (SELECT coalesce((SELECT schedule_approval_roles FROM location_settings WHERE location_id = _location), '{}') AS roles),
  cand AS (
    SELECT ul.user_id FROM user_locations ul WHERE ul.location_id = _location
    UNION
    SELECT om.user_id FROM organization_members om JOIN locations l ON l.organization_id = om.organization_id
      WHERE l.id = _location AND om.org_role = 'admin'
  )
  SELECT coalesce(array_agg(DISTINCT c.user_id), '{}')
  FROM cand c JOIN profiles p ON p.id = c.user_id, ls
  WHERE coalesce(p.is_active, true)
    AND c.user_id IS DISTINCT FROM _exclude
    AND public.get_user_role(c.user_id) IN ('admin','org_admin')
    AND NOT (public.get_user_role(c.user_id) = ANY(ls.roles));
$$;

-- The ONE publish writer
CREATE OR REPLACE FUNCTION public._publish_schedule(_schedule_id uuid, _by uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc record; v_snap jsonb; v_n int; v_ids uuid[];
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb), count(*) INTO v_snap, v_n FROM scheduled_shifts s WHERE s.schedule_id = _schedule_id;
  PERFORM set_config('croo.schedule_publish', '1', true);
  PERFORM set_config('croo.publish_by', coalesce(_by::text, ''), true);
  UPDATE schedules SET is_published = true, published_shifts_snapshot = v_snap,
    last_status_changed_at = now(), last_status_changed_by = _by, last_status_action = 'published'
  WHERE id = _schedule_id;
  PERFORM set_config('croo.schedule_publish', '', true);
  PERFORM set_config('croo.publish_by', '', true);

  SELECT array_agg(DISTINCT s.user_id) INTO v_ids FROM scheduled_shifts s
    WHERE s.schedule_id = _schedule_id AND s.user_id IS NOT NULL AND NOT coalesce(s.is_phantom,false);
  IF v_ids IS NOT NULL THEN
    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES ('schedule_published', 'schedule_published:' || _schedule_id || ':' || extract(epoch FROM clock_timestamp())::text, sc.location_id,
      jsonb_build_object('user_ids', to_jsonb(v_ids), 'title', 'Weekly Schedule Published',
        'body', 'Schedule for ' || to_char(sc.week_start_date, 'Mon FMDD') || ' - ' || to_char(sc.week_end_date, 'Mon FMDD, YYYY') || ' is now live',
        'notification_type', 'schedule_updates',
        'data', jsonb_build_object('type', 'schedule_update', 'schedule_id', _schedule_id)))
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.publish_schedule(_schedule_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc record;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF NOT (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), sc.location_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public._schedule_approval_required(auth.uid(), sc.location_id, sc.id) THEN RAISE EXCEPTION 'approval_required'; END IF;
  RETURN public._publish_schedule(_schedule_id, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.submit_schedule_for_approval(_schedule_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc record; v_appr uuid[]; v_chk jsonb; v_store text; v_name text; v_n int; v_task uuid; v_desc text;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id FOR UPDATE;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF NOT public.has_location_access(auth.uid(), sc.location_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public._schedule_decider_check(_sc public.schedules)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roles public.app_role[]; v_name text;
BEGIN
  IF NOT (public.has_role_or_higher(auth.uid(), 'admin') AND public.has_location_access(auth.uid(), _sc.location_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT schedule_approval_roles INTO v_roles FROM location_settings WHERE location_id = _sc.location_id;
  IF public.get_user_role(auth.uid()) = ANY(coalesce(v_roles, '{}')) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _sc.approval_requested_by = auth.uid() THEN RAISE EXCEPTION 'cannot_decide_own_request'; END IF;
  IF _sc.approval_status IS DISTINCT FROM 'pending' THEN
    SELECT coalesce(nullif(full_name, ''), 'someone') INTO v_name FROM profiles WHERE id = _sc.approval_decided_by;
    RAISE EXCEPTION 'already_decided by %', coalesce(v_name, 'someone');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_schedule(_schedule_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc public.schedules; v_n int;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id FOR UPDATE;
  IF sc.id IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  PERFORM public._schedule_decider_check(sc);

  PERFORM set_config('croo.schedule_approval', '1', true);
  UPDATE schedules SET approval_status = 'approved', approval_decided_by = auth.uid(), approval_decided_at = now() WHERE id = _schedule_id;
  PERFORM set_config('croo.schedule_approval', '', true);
  v_n := public._publish_schedule(_schedule_id, auth.uid());

  UPDATE temporary_tasks SET is_active = false, completed_at = now(), completed_by = auth.uid()
  WHERE schedule_id = _schedule_id AND title LIKE 'Approve schedule:%' AND completed_at IS NULL;

  INSERT INTO schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, source)
  VALUES (_schedule_id, 'approved', auth.uid(), false, true, 'system');

  IF sc.approval_requested_by IS NOT NULL THEN
    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES ('schedule_approval', 'schedule_approval:approved:' || _schedule_id || ':' || extract(epoch FROM clock_timestamp())::text, sc.location_id,
      jsonb_build_object('user_ids', jsonb_build_array(sc.approval_requested_by), 'title', 'Schedule approved and posted',
        'body', 'Week of ' || to_char(sc.week_start_date, 'Mon FMDD') || ' is now live.',
        'notification_type', 'schedule_updates',
        'data', jsonb_build_object('type', 'schedule_approval', 'schedule_id', _schedule_id,
          'url', '/schedule?location=' || sc.location_id || '&week=' || to_char(sc.week_start_date, 'YYYY-MM-DD'))))
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.send_back_schedule(_schedule_id uuid, _message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sc public.schedules; v_msg text := btrim(coalesce(_message, ''));
BEGIN
  IF length(v_msg) < 1 OR length(v_msg) > 500 THEN RAISE EXCEPTION 'message_length'; END IF;
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id FOR UPDATE;
  IF sc.id IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  PERFORM public._schedule_decider_check(sc);

  PERFORM set_config('croo.schedule_approval', '1', true);
  UPDATE schedules SET approval_status = 'changes_requested', approval_decided_by = auth.uid(), approval_decided_at = now(), approval_message = v_msg
  WHERE id = _schedule_id;
  PERFORM set_config('croo.schedule_approval', '', true);

  UPDATE temporary_tasks SET is_active = false, completed_at = now(), completed_by = auth.uid()
  WHERE schedule_id = _schedule_id AND title LIKE 'Approve schedule:%' AND completed_at IS NULL;

  IF sc.approval_requested_by IS NOT NULL THEN
    WITH t AS (
      INSERT INTO temporary_tasks (location_id, title, description, icon_name, accent_color, created_by, show_on_dashboard, schedule_id)
      VALUES (sc.location_id, 'Schedule sent back: week of ' || to_char(sc.week_start_date, 'Mon FMDD'), v_msg, 'CalendarCheck', '#F59E0B', auth.uid(), true, _schedule_id)
      RETURNING id)
    INSERT INTO temporary_task_assignments (task_id, user_id) SELECT id, sc.approval_requested_by FROM t;
  END IF;

  INSERT INTO schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, source, note)
  VALUES (_schedule_id, 'sent_back', auth.uid(), true, false, 'system', v_msg);

  IF sc.approval_requested_by IS NOT NULL THEN
    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES ('schedule_approval', 'schedule_approval:sent_back:' || _schedule_id || ':' || extract(epoch FROM clock_timestamp())::text, sc.location_id,
      jsonb_build_object('user_ids', jsonb_build_array(sc.approval_requested_by), 'title', 'Schedule sent back', 'body', v_msg,
        'notification_type', 'schedule_updates',
        'data', jsonb_build_object('type', 'schedule_approval', 'schedule_id', _schedule_id,
          'url', '/schedule?location=' || sc.location_id || '&week=' || to_char(sc.week_start_date, 'YYYY-MM-DD'))))
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_schedule_approval_settings(_location_id uuid, _enabled boolean DEFAULT NULL, _roles public.app_role[] DEFAULT NULL, _mode text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ls record; v_enabled boolean; v_roles public.app_role[]; v_mode text; v_appr uuid[];
BEGIN
  IF NOT (public.has_role_or_higher(auth.uid(), 'admin') AND public.has_location_access(auth.uid(), _location_id)) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO ls FROM location_settings WHERE location_id = _location_id FOR UPDATE;
  IF ls IS NULL THEN RAISE EXCEPTION 'location_settings_not_found'; END IF;
  v_enabled := coalesce(_enabled, ls.schedule_approval_enabled);
  v_roles := coalesce(_roles, ls.schedule_approval_roles);
  v_mode := coalesce(_mode, ls.schedule_approval_mode);
  IF array_length(v_roles, 1) IS NULL OR NOT (v_roles <@ ARRAY['manager','admin']::public.app_role[]) THEN RAISE EXCEPTION 'invalid_roles'; END IF;
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
END $$;

-- Extend ship 2 lifecycle trigger
CREATE OR REPLACE FUNCTION public.trg_schedules_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_set boolean; v_n int;
  v_pub_flag boolean := coalesce(current_setting('croo.schedule_publish', true), '') = '1';
  v_appr_flag boolean := coalesce(current_setting('croo.schedule_approval', true), '') = '1';
BEGIN
  NEW.original_shifts_snapshot := OLD.original_shifts_snapshot;
  NEW.original_published_at := OLD.original_published_at;
  NEW.original_published_by := OLD.original_published_by;
  NEW.original_replace_on_next_post := OLD.original_replace_on_next_post;

  -- (b) approval fields only via the approval functions
  IF NOT (v_pub_flag OR v_appr_flag) AND auth.uid() IS NOT NULL AND (
       NEW.approval_status IS DISTINCT FROM OLD.approval_status
    OR NEW.approval_requested_by IS DISTINCT FROM OLD.approval_requested_by
    OR NEW.approval_requested_at IS DISTINCT FROM OLD.approval_requested_at
    OR NEW.approval_decided_by IS DISTINCT FROM OLD.approval_decided_by
    OR NEW.approval_decided_at IS DISTINCT FROM OLD.approval_decided_at
    OR NEW.approval_message IS DISTINCT FROM OLD.approval_message) THEN
    RAISE EXCEPTION 'approval_fields_locked';
  END IF;

  IF NOT coalesce(OLD.is_published, false) AND coalesce(NEW.is_published, false) THEN
    -- (a) gated managers cannot publish directly
    IF NOT v_pub_flag AND auth.uid() IS NOT NULL
       AND public._schedule_approval_required(auth.uid(), NEW.location_id, NEW.id) THEN
      RAISE EXCEPTION 'approval_required';
    END IF;
    v_set := OLD.original_shifts_snapshot IS NULL OR OLD.original_replace_on_next_post;
    IF v_set THEN
      SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO NEW.original_shifts_snapshot
        FROM public.scheduled_shifts s WHERE s.schedule_id = NEW.id AND NOT s.is_phantom;
      NEW.original_published_at := now();
      NEW.original_published_by := coalesce(nullif(current_setting('croo.publish_by', true), '')::uuid, auth.uid());
      NEW.original_replace_on_next_post := false;
    END IF;
    BEGIN
      INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, note)
      VALUES (NEW.id, 'published', coalesce(nullif(current_setting('croo.publish_by', true), '')::uuid, auth.uid()), false, true, CASE WHEN v_set THEN 'Original' END);
    EXCEPTION WHEN others THEN RAISE WARNING 'schedule publish log skipped: %', SQLERRM; END;
  ELSIF coalesce(OLD.is_published, false) AND NOT coalesce(NEW.is_published, false) THEN
    NEW.original_replace_on_next_post := true;
    -- (c) withdraw clears approval state and its tasks
    NEW.approval_status := NULL; NEW.approval_requested_by := NULL; NEW.approval_requested_at := NULL;
    NEW.approval_decided_by := NULL; NEW.approval_decided_at := NULL; NEW.approval_message := NULL;
    UPDATE public.temporary_tasks SET is_active = false, completed_at = now()
      WHERE schedule_id = NEW.id AND completed_at IS NULL;
    SELECT count(*) INTO v_n FROM public.scheduled_shifts s WHERE s.schedule_id = NEW.id AND NOT s.is_phantom;
    BEGIN
      INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, note)
      VALUES (NEW.id, 'withdrawn', auth.uid(), false, true, CASE WHEN v_n = 0 THEN 'Cleared' END);
    EXCEPTION WHEN others THEN RAISE WARNING 'schedule withdraw log skipped: %', SQLERRM; END;
  ELSIF coalesce(OLD.is_published, false) AND coalesce(NEW.is_published, false)
        AND NEW.published_shifts_snapshot IS DISTINCT FROM OLD.published_shifts_snapshot THEN
    BEGIN
      UPDATE public.schedule_change_log SET is_draft = false WHERE schedule_id = NEW.id AND is_draft;
      INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live)
      VALUES (NEW.id, 'update_sent', auth.uid(), false, true);
    EXCEPTION WHEN others THEN RAISE WARNING 'schedule update log skipped: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.schedule_week_labor_check(uuid), public._schedule_approval_required(uuid,uuid,uuid),
  public._schedule_approvers(uuid,uuid), public._publish_schedule(uuid,uuid), public.publish_schedule(uuid),
  public.submit_schedule_for_approval(uuid), public._schedule_decider_check(public.schedules), public.approve_schedule(uuid),
  public.send_back_schedule(uuid,text), public.set_schedule_approval_settings(uuid,boolean,public.app_role[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_week_labor_check(uuid), public._schedule_approval_required(uuid,uuid,uuid),
  public._schedule_approvers(uuid,uuid), public.publish_schedule(uuid), public.submit_schedule_for_approval(uuid),
  public.approve_schedule(uuid), public.send_back_schedule(uuid,text),
  public.set_schedule_approval_settings(uuid,boolean,public.app_role[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._publish_schedule(uuid,uuid), public._schedule_decider_check(public.schedules) TO service_role;