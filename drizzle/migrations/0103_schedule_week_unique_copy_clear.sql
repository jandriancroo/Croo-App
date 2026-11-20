-- Schedule Copy / Clear drafts / Withdraw (Nov 19, 2026).
-- 1) One schedule per store per week: merge any duplicate week rows onto a keeper, location_id NOT NULL, unique index.
-- 2) Change log: new sources ('copy','clear_drafts') and header types ('copied','cleared_drafts');
--    Withdraw no longer writes the old 'Cleared' note; Undo reverses a whole Copy / Clear batch and its header.
-- 3) copy_schedule_week, clear_schedule_drafts RPCs (one logged batch each).
-- 4) History retention: purge change log 14 days after a week completes (daily pg_cron).
-- Rollback: DROP FUNCTION copy_schedule_week(uuid,date,text,text), clear_schedule_drafts(uuid,boolean),
--   purge_completed_week_change_log(), _schedule_week_completed(uuid,interval), _schedule_week_completed_at(uuid);
--   SELECT cron.unschedule('purge-completed-week-change-log'); DROP INDEX schedules_location_week_uidx;
--   restore trg_schedules_lifecycle / undo_schedule_change from the previous migration.

-- 1) Duplicate weeks (none at ship time; kept for safety). Keeper: published, most shifts, oldest.
DO $dedupe$
DECLARE g record; k uuid; l uuid;
BEGIN
  FOR g IN SELECT location_id, week_start_date FROM public.schedules
            GROUP BY 1, 2 HAVING count(*) > 1 LOOP
    SELECT s.id INTO k FROM public.schedules s
     WHERE s.location_id IS NOT DISTINCT FROM g.location_id AND s.week_start_date = g.week_start_date
     ORDER BY coalesce(s.is_published, false) DESC,
              (SELECT count(*) FROM public.scheduled_shifts ss WHERE ss.schedule_id = s.id) DESC,
              s.created_at ASC NULLS LAST, s.id
     LIMIT 1;
    FOR l IN SELECT s.id FROM public.schedules s
              WHERE s.location_id IS NOT DISTINCT FROM g.location_id AND s.week_start_date = g.week_start_date AND s.id <> k LOOP
      -- Move shifts that aren't exact dupes (person + date + start + end) of a keeper shift, then events.
      UPDATE public.scheduled_shifts x SET schedule_id = k
       WHERE x.schedule_id = l AND NOT EXISTS (
         SELECT 1 FROM public.scheduled_shifts y WHERE y.schedule_id = k AND y.user_id IS NOT DISTINCT FROM x.user_id
            AND y.shift_date = x.shift_date AND y.start_time = x.start_time AND y.end_time = x.end_time);
      UPDATE public.schedule_events SET schedule_id = k WHERE schedule_id = l;
      DELETE FROM public.schedules WHERE id = l;
    END LOOP;
  END LOOP;
END $dedupe$;

ALTER TABLE public.schedules ALTER COLUMN location_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS schedules_location_week_uidx ON public.schedules (location_id, week_start_date);

-- 2) Change log vocabulary.
ALTER TABLE public.schedule_change_log DROP CONSTRAINT IF EXISTS schedule_change_log_source_check;
ALTER TABLE public.schedule_change_log ADD CONSTRAINT schedule_change_log_source_check
  CHECK (source = ANY (ARRAY['edit','shift_offer','undo','revert_original','revert_today','system','copy','clear_drafts']));
ALTER TABLE public.schedule_change_log DROP CONSTRAINT IF EXISTS schedule_change_log_change_type_check;
ALTER TABLE public.schedule_change_log ADD CONSTRAINT schedule_change_log_change_type_check
  CHECK (change_type = ANY (ARRAY['added','removed','time_changed','date_changed','reassigned','details_changed',
    'published','withdrawn','update_sent','reverted','approval_requested','approved','sent_back','copied','cleared_drafts']));
CREATE INDEX IF NOT EXISTS schedule_change_log_batch_idx ON public.schedule_change_log (batch_id) WHERE batch_id IS NOT NULL;

-- Withdraw: plain 'withdrawn' (Clear has its own 'cleared_drafts' header now).
CREATE OR REPLACE FUNCTION public.trg_schedules_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_set boolean; v_n int;
  v_pub_flag boolean := coalesce(current_setting('croo.schedule_publish', true), '') = '1';
  v_appr_flag boolean := coalesce(current_setting('croo.schedule_approval', true), '') = '1';
BEGIN
  NEW.original_shifts_snapshot := OLD.original_shifts_snapshot;
  NEW.original_published_at := OLD.original_published_at;
  NEW.original_published_by := OLD.original_published_by;
  NEW.original_replace_on_next_post := OLD.original_replace_on_next_post;
  IF NOT (v_pub_flag OR v_appr_flag) AND auth.uid() IS NOT NULL AND (
       NEW.approval_status IS DISTINCT FROM OLD.approval_status
    OR NEW.approval_requested_by IS DISTINCT FROM OLD.approval_requested_by
    OR NEW.approval_requested_at IS DISTINCT FROM OLD.approval_requested_at
    OR NEW.approval_decided_by IS DISTINCT FROM OLD.approval_decided_by
    OR NEW.approval_decided_at IS DISTINCT FROM OLD.approval_decided_at
    OR NEW.approval_message IS DISTINCT FROM OLD.approval_message) THEN RAISE EXCEPTION 'approval_fields_locked'; END IF;
  IF NOT coalesce(OLD.is_published, false) AND coalesce(NEW.is_published, false) THEN
    IF NOT v_pub_flag AND auth.uid() IS NOT NULL AND public._schedule_approval_required(auth.uid(), NEW.location_id, NEW.id) THEN RAISE EXCEPTION 'approval_required'; END IF;
    v_set := OLD.original_shifts_snapshot IS NULL OR OLD.original_replace_on_next_post;
    IF v_set THEN
      SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO NEW.original_shifts_snapshot FROM public.scheduled_shifts s WHERE s.schedule_id = NEW.id AND NOT s.is_phantom;
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
    NEW.approval_status := NULL; NEW.approval_requested_by := NULL; NEW.approval_requested_at := NULL;
    NEW.approval_decided_by := NULL; NEW.approval_decided_at := NULL; NEW.approval_message := NULL;
    UPDATE public.temporary_tasks SET is_active = false, completed_at = now() WHERE schedule_id = NEW.id AND completed_at IS NULL;
    BEGIN
      INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, note)
      VALUES (NEW.id, 'withdrawn', auth.uid(), false, true, NULL);
    EXCEPTION WHEN others THEN RAISE WARNING 'schedule withdraw log skipped: %', SQLERRM; END;
  ELSIF coalesce(OLD.is_published, false) AND coalesce(NEW.is_published, false) AND NEW.published_shifts_snapshot IS DISTINCT FROM OLD.published_shifts_snapshot THEN
    BEGIN
      UPDATE public.schedule_change_log SET is_draft = false WHERE schedule_id = NEW.id AND is_draft
        AND (nullif(current_setting('croo.marketplace_publish_shift', true), '') IS NULL OR shift_id = nullif(current_setting('croo.marketplace_publish_shift', true), '')::uuid);
      INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live) VALUES (NEW.id, 'update_sent', auth.uid(), false, true);
    EXCEPTION WHEN others THEN RAISE WARNING 'schedule update log skipped: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $function$;

-- Undo: a Copy / Clear drafts batch is reversed as one, header included.
CREATE OR REPLACE FUNCTION public.undo_schedule_change(_schedule_id uuid, _dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_desc := CASE WHEN l.source IN ('revert_original','revert_today') THEN 'Revert ('
                   WHEN l.source = 'copy' THEN 'Copy ('
                   WHEN l.source = 'clear_drafts' THEN 'Clear drafts ('
                   ELSE 'Batch (' END
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
  -- Copy / Clear drafts: the batch's header line is undone with it.
  IF l.batch_id IS NOT NULL THEN
    UPDATE public.schedule_change_log SET undone_at = now(), undone_by = auth.uid()
     WHERE schedule_id = _schedule_id AND batch_id = l.batch_id AND shift_id IS NULL
       AND change_type IN ('copied','cleared_drafts') AND undone_at IS NULL;
  END IF;
  RETURN jsonb_build_object('description', v_desc);
END $function$;

-- 4) Copy Week on the server: one schedule per week, posted target refused, Merge skips exact dupes,
--    stations carried (only the target store's own), one logged batch + one header row.
CREATE OR REPLACE FUNCTION public.copy_schedule_week(
  _source_schedule_id uuid, _target_week_start date, _mode text DEFAULT 'copy', _from text DEFAULT 'current')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  src public.schedules; tgt public.schedules; v_rows jsonb; v_offset int; v_existing int;
  v_added int := 0; v_total int := 0; v_batch uuid := gen_random_uuid(); v_note text;
BEGIN
  IF _mode NOT IN ('copy','merge') OR _from NOT IN ('current','published') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023'; END IF;

  -- Source store comes from the schedule row, never from the caller.
  SELECT * INTO src FROM public.schedules WHERE id = _source_schedule_id;
  IF NOT FOUND OR NOT public._can_edit_schedule(auth.uid(), src.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;

  v_offset := _target_week_start - src.week_start_date;
  IF v_offset <= 0 OR v_offset % 7 <> 0 THEN RAISE EXCEPTION 'invalid target week' USING ERRCODE = '22023'; END IF;

  -- Target: the store's one row for that week (unique index), created as a draft only when missing.
  SELECT * INTO tgt FROM public.schedules
   WHERE location_id = src.location_id AND week_start_date = _target_week_start FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.schedules (week_start_date, week_end_date, location_id, is_published, created_by)
    VALUES (_target_week_start, _target_week_start + 6, src.location_id, false, auth.uid())
    ON CONFLICT (location_id, week_start_date) DO NOTHING;
    SELECT * INTO tgt FROM public.schedules
     WHERE location_id = src.location_id AND week_start_date = _target_week_start FOR UPDATE;
  END IF;
  -- Target store also comes from its row; the caller must be able to edit it too.
  IF NOT public._can_edit_schedule(auth.uid(), tgt.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF coalesce(tgt.is_published, false) THEN RAISE EXCEPTION 'target_is_live' USING ERRCODE = 'P0001'; END IF;

  SELECT count(*) INTO v_existing FROM public.scheduled_shifts WHERE schedule_id = tgt.id AND NOT is_phantom;
  IF _mode = 'copy' AND v_existing > 0 THEN RAISE EXCEPTION 'target_has_shifts' USING ERRCODE = 'P0001'; END IF;

  IF _from = 'published' THEN
    IF NOT coalesce(src.is_published, false) OR jsonb_typeof(src.published_shifts_snapshot) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'source_not_posted' USING ERRCODE = 'P0001'; END IF;
    v_rows := src.published_shifts_snapshot;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_rows
      FROM public.scheduled_shifts s WHERE s.schedule_id = src.id AND NOT s.is_phantom;
  END IF;

  PERFORM set_config('croo.change_source', 'copy', true);
  PERFORM set_config('croo.change_batch', v_batch::text, true);

  WITH src_rows AS (
    SELECT r.user_id, (r.shift_date + v_offset) AS shift_date, r.day_of_week, r.start_time, r.end_time,
           coalesce(r.is_time_off, false) AS is_time_off, r.template_id,
           CASE WHEN r.station_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.location_stations ls WHERE ls.id = r.station_id AND ls.location_id = tgt.location_id)
                THEN r.station_id END AS station_id
      FROM jsonb_populate_recordset(NULL::public.scheduled_shifts, v_rows) r
     WHERE NOT coalesce(r.is_phantom, false)
  ), numbered AS (
    SELECT sr.*, row_number() OVER (PARTITION BY sr.user_id, sr.shift_date, sr.start_time, sr.end_time ORDER BY sr.start_time) AS rn
      FROM src_rows sr
  ), have AS (
    SELECT ss.user_id, ss.shift_date, ss.start_time, ss.end_time, count(*) AS n
      FROM public.scheduled_shifts ss WHERE ss.schedule_id = tgt.id AND NOT ss.is_phantom
     GROUP BY 1, 2, 3, 4
  ), ins AS (
    INSERT INTO public.scheduled_shifts (schedule_id, user_id, day_of_week, shift_date, start_time, end_time, is_time_off, template_id, station_id)
    SELECT tgt.id, nb.user_id, nb.day_of_week, nb.shift_date, nb.start_time, nb.end_time, nb.is_time_off, nb.template_id, nb.station_id
      FROM numbered nb
      LEFT JOIN have h ON h.user_id IS NOT DISTINCT FROM nb.user_id AND h.shift_date = nb.shift_date
                      AND h.start_time = nb.start_time AND h.end_time = nb.end_time
     WHERE nb.rn > coalesce(h.n, 0)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins), (SELECT count(*) FROM src_rows) INTO v_added, v_total;

  PERFORM set_config('croo.change_source', '', true);
  PERFORM set_config('croo.change_batch', '', true);

  v_note := CASE WHEN _mode = 'merge'
    THEN 'Merged from week of ' || to_char(src.week_start_date, 'Mon FMDD') || ': ' || v_added || ' added, '
         || (v_total - v_added) || ' duplicate' || CASE WHEN v_total - v_added = 1 THEN '' ELSE 's' END || ' skipped'
    ELSE 'Copied from week of ' || to_char(src.week_start_date, 'Mon FMDD') || ': ' || v_added || ' shift' || CASE WHEN v_added = 1 THEN '' ELSE 's' END END;
  INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, source, batch_id, note)
  VALUES (tgt.id, 'copied', auth.uid(), false, false, 'copy', v_batch, v_note);

  RETURN jsonb_build_object('target_schedule_id', tgt.id, 'mode', _mode, 'added', v_added, 'skipped', v_total - v_added, 'batch_id', v_batch);
END $$;
REVOKE ALL ON FUNCTION public.copy_schedule_week(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_schedule_week(uuid, date, text, text) TO authenticated, service_role;

-- 5) Clear drafts only. Lock the week, re-check publish state under the lock, then:
--    posted week -> back to its posted snapshot; unposted week -> drafts removed.
--    _apply_schedule_state skips past days and punched shifts. Publish state is never touched (that's Withdraw).
CREATE OR REPLACE FUNCTION public.clear_schedule_drafts(_schedule_id uuid, _dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.schedules; v_live boolean; v_t jsonb; v_res jsonb; v_batch uuid := gen_random_uuid(); v_n int; v_skip int;
BEGIN
  SELECT * INTO s FROM public.schedules WHERE id = _schedule_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_edit_schedule(auth.uid(), s.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  v_live := coalesce(s.is_published, false);
  IF v_live THEN
    IF jsonb_typeof(s.published_shifts_snapshot) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'no_posted_snapshot' USING ERRCODE = 'P0001'; END IF;
    v_t := s.published_shifts_snapshot;   -- drafts = differences from what was posted
  ELSE
    v_t := '[]'::jsonb;                   -- unposted: every shift is a draft
  END IF;

  v_res := public._apply_schedule_state(_schedule_id, v_t, 'clear_drafts', v_batch, _dry_run);
  v_res := v_res || jsonb_build_object('week_live', v_live);
  IF _dry_run THEN RETURN v_res; END IF;

  v_n := (v_res->>'shifts_affected')::int;
  v_skip := (v_res->>'skipped_past')::int + (v_res->>'skipped_punched')::int;
  IF v_n > 0 THEN
    INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, source, batch_id, note)
    VALUES (_schedule_id, 'cleared_drafts', auth.uid(), false, v_live, 'clear_drafts', v_batch,
      'Cleared drafts: ' || v_n || ' change' || CASE WHEN v_n = 1 THEN '' ELSE 's' END
      || CASE WHEN v_skip > 0 THEN ', ' || v_skip || ' skipped (worked or punched)' ELSE '' END);
  END IF;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.clear_schedule_drafts(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_schedule_drafts(uuid, boolean) TO authenticated, service_role;

-- 7) History retention. A week is completed when its last shift has ended (overnight shifts by their end,
--    store time zone); an empty week when week_start + 7 days has passed. Keep 14 days after that, then purge.
CREATE OR REPLACE FUNCTION public._schedule_week_completed_at(_schedule_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    max(((ss.shift_date + ss.end_time) + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END)
        AT TIME ZONE coalesce(ls.timezone, 'America/Los_Angeles')),
    ((s.week_start_date + 7)::timestamp AT TIME ZONE coalesce(ls.timezone, 'America/Los_Angeles')))
  FROM public.schedules s
  LEFT JOIN public.location_settings ls ON ls.location_id = s.location_id
  LEFT JOIN public.scheduled_shifts ss ON ss.schedule_id = s.id AND NOT ss.is_phantom
  WHERE s.id = _schedule_id
  GROUP BY s.week_start_date, ls.timezone;
$$;

CREATE OR REPLACE FUNCTION public._schedule_week_completed(_schedule_id uuid, _keep interval DEFAULT interval '0')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(public._schedule_week_completed_at(_schedule_id) + _keep < now(), false);
$$;

-- Daily job. Deletes change log rows for every week completed more than 14 days ago.
-- Kept a little longer: the reassigned/removed rows the employee profile's 90-day "original shifts" stats read
-- (original_shift_changes); those go once the week is 90 days past. Schedules, shifts, snapshots, punches untouched.
CREATE OR REPLACE FUNCTION public.purge_completed_week_change_log()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c_keep constant interval := interval '14 days';
  c_profile_stats constant interval := interval '90 days';
  v_n int;
BEGIN
  WITH done AS (
    SELECT s.id, public._schedule_week_completed(s.id, c_profile_stats) AS past_stats
      FROM public.schedules s
     WHERE s.week_start_date <= (now() - c_keep)::date
       AND EXISTS (SELECT 1 FROM public.schedule_change_log l WHERE l.schedule_id = s.id)
       AND public._schedule_week_completed(s.id, c_keep)
  ), del AS (
    DELETE FROM public.schedule_change_log l USING done d
     WHERE l.schedule_id = d.id
       AND (d.past_stats OR NOT (l.change_type IN ('reassigned','removed') AND l.undone_at IS NULL AND l.user_id IS NOT NULL))
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public._schedule_week_completed_at(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._schedule_week_completed(uuid, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_completed_week_change_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._schedule_week_completed_at(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._schedule_week_completed(uuid, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_completed_week_change_log() TO service_role;

-- 3:40 AM Pacific (11:40 UTC), after the nightly jobs.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-completed-week-change-log';
    PERFORM cron.schedule('purge-completed-week-change-log', '40 11 * * *', 'SELECT public.purge_completed_week_change_log();');
  END IF;
END $cron$;
