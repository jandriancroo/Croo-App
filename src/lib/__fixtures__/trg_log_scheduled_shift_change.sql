CREATE OR REPLACE FUNCTION public.trg_log_scheduled_shift_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
