CREATE OR REPLACE FUNCTION public._apply_schedule_state(_schedule_id uuid, _target jsonb, _source text, _batch uuid, _dry_run boolean, _reverts uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
