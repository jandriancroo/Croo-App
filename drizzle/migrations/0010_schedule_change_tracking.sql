-- 1. Change log columns
ALTER TABLE public.schedule_change_log ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.schedule_change_log DROP CONSTRAINT schedule_change_log_user_id_fkey;
ALTER TABLE public.schedule_change_log ADD CONSTRAINT schedule_change_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.schedule_change_log
  ADD COLUMN week_live boolean NOT NULL DEFAULT true,
  ADD COLUMN note text,
  ADD COLUMN shift_id uuid,
  ADD COLUMN source text NOT NULL DEFAULT 'edit'
    CHECK (source IN ('edit','shift_offer','undo','revert_original','revert_today','system')),
  ADD COLUMN batch_id uuid,
  ADD COLUMN reverts_log_id uuid REFERENCES public.schedule_change_log(id) ON DELETE SET NULL,
  ADD COLUMN undone_at timestamptz,
  ADD COLUMN undone_by uuid;
ALTER TABLE public.schedule_change_log DROP CONSTRAINT schedule_change_log_change_type_check;
ALTER TABLE public.schedule_change_log ADD CONSTRAINT schedule_change_log_change_type_check CHECK (change_type IN (
  'added','removed','time_changed','date_changed','reassigned','details_changed','published','withdrawn',
  'update_sent','reverted','approval_requested','approved','sent_back'));
CREATE INDEX IF NOT EXISTS schedule_change_log_schedule_created_idx ON public.schedule_change_log (schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS schedule_change_log_shift_idx ON public.schedule_change_log (shift_id);

-- 2. Original publish snapshot
ALTER TABLE public.schedules
  ADD COLUMN original_shifts_snapshot jsonb,
  ADD COLUMN original_published_at timestamptz,
  ADD COLUMN original_published_by uuid,
  ADD COLUMN original_replace_on_next_post boolean NOT NULL DEFAULT false;

-- Who may edit a store's schedule (same role check as the shift policy + store access)
CREATE OR REPLACE FUNCTION public._can_edit_schedule(_user uuid, _location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _user IS NOT NULL
     AND (public.has_role(_user, 'admin'::app_role) OR public.has_role(_user, 'manager'::app_role))
     AND public.has_location_access(_user, _location_id);
$$;
REVOKE EXECUTE ON FUNCTION public._can_edit_schedule(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_edit_schedule(uuid, uuid) TO authenticated, service_role;

-- 3. Shift change trigger
CREATE OR REPLACE FUNCTION public.trg_log_scheduled_shift_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sched uuid; v_live boolean; v_type text; v_src text; v_user uuid; v_old jsonb; v_new jsonb; v_id uuid;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.schedule_id IS NULL OR NEW.is_phantom THEN RETURN NULL; END IF;
      v_sched := NEW.schedule_id; v_id := NEW.id; v_type := 'added'; v_user := NEW.user_id; v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.schedule_id IS NULL OR OLD.is_phantom THEN RETURN NULL; END IF;
      v_sched := OLD.schedule_id; v_id := OLD.id; v_type := 'removed'; v_user := OLD.user_id; v_old := to_jsonb(OLD);
    ELSE
      IF NEW.schedule_id IS NULL OR NEW.is_phantom OR OLD.is_phantom THEN RETURN NULL; END IF;
      v_sched := NEW.schedule_id; v_id := NEW.id; v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN v_type := 'reassigned'; v_user := OLD.user_id;
      ELSIF NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN v_type := 'time_changed';
      ELSIF NEW.shift_date IS DISTINCT FROM OLD.shift_date OR NEW.day_of_week IS DISTINCT FROM OLD.day_of_week THEN v_type := 'date_changed';
      ELSIF NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.station_id IS DISTINCT FROM OLD.station_id
         OR NEW.breaks IS DISTINCT FROM OLD.breaks OR NEW.is_time_off IS DISTINCT FROM OLD.is_time_off
         OR NEW.is_coverage_only IS DISTINCT FROM OLD.is_coverage_only THEN v_type := 'details_changed';
      ELSE RETURN NULL;
      END IF;
      IF v_type <> 'reassigned' THEN v_user := NEW.user_id; END IF;
    END IF;

    SELECT coalesce(s.is_published, false) INTO v_live FROM public.schedules s WHERE s.id = v_sched;
    v_src := nullif(current_setting('croo.change_source', true), '');
    IF v_src IS NULL THEN
      IF v_type = 'reassigned' AND EXISTS (SELECT 1 FROM public.shift_offers o WHERE o.shift_id = NEW.id AND o.status = 'approved'
            AND o.offered_by_user_id IS NOT DISTINCT FROM OLD.user_id AND o.claimed_by_user_id IS NOT DISTINCT FROM NEW.user_id) THEN
        v_src := 'shift_offer';
      ELSE v_src := 'edit';
      END IF;
    END IF;

    INSERT INTO public.schedule_change_log (schedule_id, user_id, change_type, old_shift_data, new_shift_data, changed_by,
      is_draft, week_live, shift_id, source, batch_id, reverts_log_id)
    VALUES (v_sched, v_user, v_type, v_old, v_new, auth.uid(), coalesce(v_live, false), coalesce(v_live, false), v_id, v_src,
      nullif(current_setting('croo.change_batch', true), '')::uuid, nullif(current_setting('croo.reverts_log', true), '')::uuid);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'schedule change log skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.trg_log_scheduled_shift_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_log_scheduled_shift_change AFTER INSERT OR UPDATE OR DELETE ON public.scheduled_shifts
  FOR EACH ROW EXECUTE FUNCTION public.trg_log_scheduled_shift_change();

-- 4. Schedules lifecycle trigger (the one schedules trigger)
CREATE OR REPLACE FUNCTION public.trg_schedules_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_set boolean; v_n int;
BEGIN
  NEW.original_shifts_snapshot := OLD.original_shifts_snapshot;
  NEW.original_published_at := OLD.original_published_at;
  NEW.original_published_by := OLD.original_published_by;
  NEW.original_replace_on_next_post := OLD.original_replace_on_next_post;

  IF NOT coalesce(OLD.is_published, false) AND coalesce(NEW.is_published, false) THEN
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
      VALUES (NEW.id, 'published', auth.uid(), false, true, CASE WHEN v_set THEN 'Original' END);
    EXCEPTION WHEN others THEN RAISE WARNING 'schedule publish log skipped: %', SQLERRM; END;
  ELSIF coalesce(OLD.is_published, false) AND NOT coalesce(NEW.is_published, false) THEN
    NEW.original_replace_on_next_post := true;
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
END $$;
REVOKE EXECUTE ON FUNCTION public.trg_schedules_lifecycle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_schedules_lifecycle BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.trg_schedules_lifecycle();

-- 5. Seed originals for current/future live weeks (trigger off so it can set original_*)
ALTER TABLE public.schedules DISABLE TRIGGER trg_schedules_lifecycle;
ALTER TABLE public.schedules DISABLE TRIGGER update_schedules_updated_at;
UPDATE public.schedules SET original_shifts_snapshot = coalesce(published_shifts_snapshot, '[]'::jsonb),
       original_published_at = coalesce(last_status_changed_at, now())
 WHERE is_published AND week_end_date >= current_date AND original_shifts_snapshot IS NULL;
ALTER TABLE public.schedules ENABLE TRIGGER update_schedules_updated_at;
ALTER TABLE public.schedules ENABLE TRIGGER trg_schedules_lifecycle;
INSERT INTO public.schedule_change_log (schedule_id, change_type, is_draft, week_live, source, note, created_at)
SELECT id, 'published', false, true, 'system', 'Original seeded at ship (last sent version)', coalesce(last_status_changed_at, now())
  FROM public.schedules WHERE is_published AND week_end_date >= current_date;

-- 6. Restore engine
CREATE OR REPLACE FUNCTION public._shift_cmp(_s jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('user_id', _s->'user_id', 'template_id', _s->'template_id', 'day_of_week', _s->'day_of_week',
    'shift_date', _s->'shift_date', 'start_time', _s->'start_time', 'end_time', _s->'end_time',
    'is_time_off', coalesce(_s->'is_time_off', 'false'::jsonb), 'was_trimmed', coalesce(_s->'was_trimmed', 'false'::jsonb),
    'original_end_time', _s->'original_end_time', 'station_id', _s->'station_id',
    'breaks', coalesce(_s->'breaks', '[]'::jsonb), 'is_coverage_only', coalesce(_s->'is_coverage_only', 'false'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._apply_schedule_state(_schedule_id uuid, _target jsonb, _source text, _batch uuid,
  _dry_run boolean, _reverts uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_loc uuid; v_today date; v_cur jsonb := '{}'::jsonb; v_tgt jsonb := '{}'::jsonb; k text; c jsonb; t jsonb;
  v_aff int := 0; v_past int := 0; v_punch int := 0; v_people uuid[] := '{}';
BEGIN
  SELECT location_id INTO v_loc FROM public.schedules WHERE id = _schedule_id;
  v_today := public.business_date(v_loc, now());
  SELECT coalesce(jsonb_object_agg(s.id::text, to_jsonb(s)), '{}'::jsonb) INTO v_cur
    FROM public.scheduled_shifts s WHERE s.schedule_id = _schedule_id AND NOT s.is_phantom;
  SELECT coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) INTO v_tgt
    FROM jsonb_array_elements(coalesce(_target, '[]'::jsonb)) e
   WHERE e ? 'id' AND NOT coalesce((e->>'is_phantom')::boolean, false);

  IF NOT _dry_run THEN
    PERFORM set_config('croo.change_source', _source, true);
    PERFORM set_config('croo.change_batch', coalesce(_batch::text, ''), true);
    PERFORM set_config('croo.reverts_log', coalesce(_reverts::text, ''), true);
  END IF;

  -- Remove shifts not in the target
  FOR k, c IN SELECT * FROM jsonb_each(v_cur) LOOP
    CONTINUE WHEN v_tgt ? k;
    IF (c->>'shift_date')::date < v_today THEN v_past := v_past + 1; CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.time_punches p WHERE p.shift_id = k::uuid) THEN v_punch := v_punch + 1; CONTINUE; END IF;
    v_aff := v_aff + 1; IF c->>'user_id' IS NOT NULL THEN v_people := v_people || (c->>'user_id')::uuid; END IF;
    IF NOT _dry_run THEN DELETE FROM public.scheduled_shifts WHERE id = k::uuid; END IF;
  END LOOP;

  FOR k, t IN SELECT * FROM jsonb_each(v_tgt) LOOP
    c := v_cur->k;
    IF c IS NULL THEN
      IF (t->>'shift_date')::date < v_today THEN v_past := v_past + 1; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.scheduled_shifts s WHERE s.id = k::uuid) THEN CONTINUE; END IF;
      v_aff := v_aff + 1; IF t->>'user_id' IS NOT NULL THEN v_people := v_people || (t->>'user_id')::uuid; END IF;
      IF NOT _dry_run THEN
        INSERT INTO public.scheduled_shifts
        SELECT (jsonb_populate_record(NULL::public.scheduled_shifts,
                 t || jsonb_build_object('schedule_id', _schedule_id, 'is_phantom', false))).*
        ON CONFLICT (id) DO NOTHING;
      END IF;
    ELSIF public._shift_cmp(c) IS DISTINCT FROM public._shift_cmp(t) THEN
      IF (c->>'shift_date')::date < v_today OR (t->>'shift_date')::date < v_today THEN v_past := v_past + 1; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.time_punches p WHERE p.shift_id = k::uuid) THEN v_punch := v_punch + 1; CONTINUE; END IF;
      v_aff := v_aff + 1;
      IF c->>'user_id' IS NOT NULL THEN v_people := v_people || (c->>'user_id')::uuid; END IF;
      IF t->>'user_id' IS NOT NULL THEN v_people := v_people || (t->>'user_id')::uuid; END IF;
      IF NOT _dry_run THEN
        UPDATE public.scheduled_shifts s SET
          user_id = r.user_id, template_id = r.template_id, day_of_week = r.day_of_week, shift_date = r.shift_date,
          start_time = r.start_time, end_time = r.end_time, is_time_off = r.is_time_off, was_trimmed = r.was_trimmed,
          original_end_time = r.original_end_time, station_id = r.station_id, breaks = coalesce(r.breaks, '[]'::jsonb),
          is_coverage_only = coalesce(r.is_coverage_only, false)
        FROM jsonb_populate_record(NULL::public.scheduled_shifts, t) r
        WHERE s.id = k::uuid;
      END IF;
    END IF;
  END LOOP;

  IF NOT _dry_run THEN
    PERFORM set_config('croo.change_source', '', true);
    PERFORM set_config('croo.change_batch', '', true);
    PERFORM set_config('croo.reverts_log', '', true);
  END IF;

  RETURN jsonb_build_object('shifts_affected', v_aff,
    'people', (SELECT count(DISTINCT x) FROM unnest(v_people) x),
    'skipped_past', v_past, 'skipped_punched', v_punch);
END $$;
REVOKE EXECUTE ON FUNCTION public._apply_schedule_state(uuid, jsonb, text, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._apply_schedule_state(uuid, jsonb, text, uuid, boolean, uuid) TO service_role;

-- Inverse of shift-level log rows (newest first) applied to a current-state map
CREATE OR REPLACE FUNCTION public._invert_log_rows(_state jsonb, _rows public.schedule_change_log[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE r public.schedule_change_log; m jsonb := _state;
BEGIN
  FOREACH r IN ARRAY _rows LOOP
    IF r.change_type = 'added' THEN m := m - r.shift_id::text;
    ELSIF r.old_shift_data IS NOT NULL THEN m := m || jsonb_build_object(r.shift_id::text, r.old_shift_data);
    END IF;
  END LOOP;
  RETURN m;
END $$;

CREATE OR REPLACE FUNCTION public.restore_schedule(_schedule_id uuid, _target text, _dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.schedules; v_t jsonb; v_src text; v_from timestamptz; v_state jsonb; v_rows public.schedule_change_log[];
  v_dry jsonb; v_res jsonb; v_batch uuid := gen_random_uuid(); v_skip int;
BEGIN
  SELECT * INTO s FROM public.schedules WHERE id = _schedule_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_edit_schedule(auth.uid(), s.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF coalesce(s.is_published, false) THEN RAISE EXCEPTION 'week_is_live' USING ERRCODE = 'P0001'; END IF;

  IF _target = 'original' THEN
    IF s.original_shifts_snapshot IS NULL THEN RAISE EXCEPTION 'no_original' USING ERRCODE = 'P0001'; END IF;
    v_t := s.original_shifts_snapshot; v_src := 'revert_original';
  ELSIF _target = 'start_of_today' THEN
    SELECT w.start_at INTO v_from FROM public.business_day_window(s.location_id, public.business_date(s.location_id, now())) w;
    SELECT coalesce(jsonb_object_agg(x.id::text, to_jsonb(x)), '{}'::jsonb) INTO v_state
      FROM public.scheduled_shifts x WHERE x.schedule_id = _schedule_id AND NOT x.is_phantom;
    SELECT coalesce(array_agg(l ORDER BY l.created_at DESC, l.id DESC), '{}') INTO v_rows
      FROM public.schedule_change_log l
     WHERE l.schedule_id = _schedule_id AND l.shift_id IS NOT NULL AND l.created_at > v_from
       AND l.change_type IN ('added','removed','time_changed','date_changed','reassigned','details_changed');
    v_state := public._invert_log_rows(v_state, v_rows);
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO v_t FROM jsonb_each(v_state);
    v_src := 'revert_today';
  ELSE
    RAISE EXCEPTION 'invalid target' USING ERRCODE = '22023';
  END IF;

  v_dry := public._apply_schedule_state(_schedule_id, v_t, v_src, v_batch, true);
  IF (v_dry->>'shifts_affected')::int = 0 THEN RAISE EXCEPTION 'nothing_to_restore' USING ERRCODE = 'P0001'; END IF;
  IF _dry_run THEN RETURN v_dry; END IF;

  v_res := public._apply_schedule_state(_schedule_id, v_t, v_src, v_batch, false);
  v_skip := (v_res->>'skipped_past')::int + (v_res->>'skipped_punched')::int;
  INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, source, batch_id, note)
  VALUES (_schedule_id, 'reverted', auth.uid(), false, false, v_src, v_batch,
    CASE WHEN _target = 'original' THEN 'Reverted to original publish' ELSE 'Reverted to start of today' END
    || ': ' || (v_res->>'shifts_affected') || ' shift' || CASE WHEN (v_res->>'shifts_affected')::int = 1 THEN '' ELSE 's' END
    || CASE WHEN v_skip > 0 THEN ', ' || v_skip || ' skipped (past days or punched)' ELSE '' END);
  RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.restore_schedule(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_schedule(uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._shift_change_desc(_r public.schedule_change_log)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o jsonb := _r.old_shift_data; n jsonb := _r.new_shift_data; b jsonb := coalesce(_r.new_shift_data, _r.old_shift_data);
  fn text; tn text;
  nm text; dy text; tm text;
BEGIN
  SELECT coalesce(split_part(p.full_name, ' ', 1), 'Someone') INTO fn FROM public.profiles p WHERE p.id = (coalesce(o, n)->>'user_id')::uuid;
  SELECT coalesce(split_part(p.full_name, ' ', 1), 'Someone') INTO tn FROM public.profiles p WHERE p.id = (n->>'user_id')::uuid;
  nm := coalesce(fn, 'Open shift');
  dy := to_char((b->>'shift_date')::date, 'Dy');
  tm := to_char((b->>'start_time')::time, 'FMHH12:MI AM') || '–' || to_char((b->>'end_time')::time, 'FMHH12:MI AM');
  RETURN CASE _r.change_type
    WHEN 'added' THEN 'Added ' || coalesce(tn, 'open shift') || ' ' || dy || ' ' || tm
    WHEN 'removed' THEN 'Removed ' || nm || ' ' || dy || ' ' || tm
    WHEN 'reassigned' THEN nm || ' ' || dy || ' ' || tm || ' → ' || coalesce(tn, 'open shift')
    WHEN 'time_changed' THEN nm || ' ' || dy || ' ' || to_char((o->>'start_time')::time, 'FMHH12:MI AM') || '–'
      || to_char((o->>'end_time')::time, 'FMHH12:MI AM') || ' → ' || tm
    WHEN 'date_changed' THEN nm || ' ' || to_char((o->>'shift_date')::date, 'Dy') || ' → ' || dy
    ELSE nm || ' ' || dy || ' details'
  END;
END $$;
REVOKE EXECUTE ON FUNCTION public._shift_change_desc(public.schedule_change_log) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.undo_schedule_change(_schedule_id uuid, _dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s public.schedules; l public.schedule_change_log; v_rows public.schedule_change_log[]; r public.schedule_change_log;
  v_state jsonb; v_t jsonb; v_desc text; v_dry jsonb; v_cur jsonb; v_seen text[] := '{}';
BEGIN
  SELECT * INTO s FROM public.schedules WHERE id = _schedule_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_edit_schedule(auth.uid(), s.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;

  SELECT * INTO l FROM public.schedule_change_log x
   WHERE x.schedule_id = _schedule_id AND x.shift_id IS NOT NULL
     AND x.change_type IN ('added','removed','time_changed','date_changed','reassigned','details_changed')
     AND x.created_at > now() - interval '10 minutes' AND x.undone_at IS NULL AND x.source <> 'undo'
     AND (NOT coalesce(s.is_published, false) OR (x.week_live AND x.is_draft))
   ORDER BY x.created_at DESC, x.id DESC LIMIT 1;
  IF NOT FOUND THEN
    IF _dry_run THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'nothing_to_undo' USING ERRCODE = 'P0001';
  END IF;

  IF l.batch_id IS NOT NULL THEN
    SELECT array_agg(x ORDER BY x.created_at DESC, x.id DESC) INTO v_rows FROM public.schedule_change_log x
     WHERE x.schedule_id = _schedule_id AND x.batch_id = l.batch_id AND x.shift_id IS NOT NULL AND x.undone_at IS NULL
       AND x.change_type IN ('added','removed','time_changed','date_changed','reassigned','details_changed');
    v_desc := CASE WHEN l.source IN ('revert_original','revert_today') THEN 'Revert (' ELSE 'Batch (' END
      || cardinality(v_rows) || ' change' || CASE WHEN cardinality(v_rows) = 1 THEN '' ELSE 's' END || ')';
  ELSE
    v_rows := ARRAY[l]; v_desc := public._shift_change_desc(l);
  END IF;

  IF _dry_run THEN RETURN jsonb_build_object('description', v_desc); END IF;

  -- Each shift must still look like the logged result
  FOREACH r IN ARRAY v_rows LOOP
    CONTINUE WHEN r.shift_id::text = ANY (v_seen);
    v_seen := v_seen || r.shift_id::text;
    SELECT to_jsonb(x) INTO v_cur FROM public.scheduled_shifts x WHERE x.id = r.shift_id;
    IF r.change_type = 'removed' THEN
      IF v_cur IS NOT NULL THEN RAISE EXCEPTION 'changed_since' USING ERRCODE = 'P0001'; END IF;
    ELSIF v_cur IS NULL OR public._shift_cmp(v_cur) IS DISTINCT FROM public._shift_cmp(r.new_shift_data) THEN
      RAISE EXCEPTION 'changed_since' USING ERRCODE = 'P0001';
    END IF;
    v_cur := NULL;
  END LOOP;

  SELECT coalesce(jsonb_object_agg(x.id::text, to_jsonb(x)), '{}'::jsonb) INTO v_state
    FROM public.scheduled_shifts x WHERE x.schedule_id = _schedule_id AND NOT x.is_phantom;
  v_state := public._invert_log_rows(v_state, v_rows);
  SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO v_t FROM jsonb_each(v_state);

  v_dry := public._apply_schedule_state(_schedule_id, v_t, 'undo', NULL, true);
  IF (v_dry->>'skipped_past')::int + (v_dry->>'skipped_punched')::int > 0 THEN
    RAISE EXCEPTION 'cannot_undo' USING ERRCODE = 'P0001'; END IF;
  PERFORM public._apply_schedule_state(_schedule_id, v_t, 'undo', l.batch_id, false, l.id);
  UPDATE public.schedule_change_log SET undone_at = now(), undone_by = auth.uid()
   WHERE id = ANY (SELECT (x).id FROM unnest(v_rows) x);
  RETURN jsonb_build_object('description', v_desc);
END $$;
REVOKE EXECUTE ON FUNCTION public.undo_schedule_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_schedule_change(uuid, boolean) TO authenticated, service_role;

-- 7. RLS
DROP POLICY IF EXISTS "Admins and managers can manage change logs" ON public.schedule_change_log;
CREATE POLICY "Store managers can view change logs" ON public.schedule_change_log FOR SELECT TO authenticated
  USING ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role))
     AND public.has_location_access(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = schedule_id)));
REVOKE INSERT, UPDATE, DELETE ON public.schedule_change_log FROM anon, authenticated;
GRANT SELECT ON public.schedule_change_log TO authenticated;
GRANT ALL ON public.schedule_change_log TO service_role;

DROP POLICY IF EXISTS "Admins and managers can manage scheduled shifts" ON public.scheduled_shifts;
CREATE POLICY "Admins and managers can manage scheduled shifts" ON public.scheduled_shifts FOR ALL TO authenticated
  USING (((SELECT public.has_role(auth.uid(), 'admin'::app_role)) OR (SELECT public.has_role(auth.uid(), 'manager'::app_role)))
     AND (schedule_id IS NULL OR public.has_location_access(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = schedule_id))))
  WITH CHECK (((SELECT public.has_role(auth.uid(), 'admin'::app_role)) OR (SELECT public.has_role(auth.uid(), 'manager'::app_role)))
     AND (schedule_id IS NULL OR public.has_location_access(auth.uid(), (SELECT sc.location_id FROM public.schedules sc WHERE sc.id = schedule_id))));