CREATE OR REPLACE FUNCTION public._update_marketplace_publication(_shift_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sc public.schedules; sh jsonb; snap jsonb;
BEGIN
  SELECT s.* INTO sc FROM public.schedules s JOIN public.scheduled_shifts ss ON ss.schedule_id=s.id WHERE ss.id=_shift_id FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF NOT coalesce(sc.is_published, false) THEN RAISE EXCEPTION 'Publish this schedule before assigning an open shift'; END IF;
  SELECT to_jsonb(ss) INTO sh FROM public.scheduled_shifts ss WHERE ss.id=_shift_id;
  IF jsonb_typeof(sc.published_shifts_snapshot) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Published schedule snapshot is missing'; END IF;
  SELECT coalesce(jsonb_agg(CASE WHEN e->>'id'=_shift_id::text THEN sh ELSE e END ORDER BY ord), '[]'::jsonb)
    INTO snap FROM jsonb_array_elements(sc.published_shifts_snapshot) WITH ORDINALITY AS x(e,ord);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snap) e WHERE e->>'id'=_shift_id::text) THEN snap := snap || jsonb_build_array(sh); END IF;
  IF snap IS DISTINCT FROM sc.published_shifts_snapshot THEN
    PERFORM set_config('croo.marketplace_publish_shift', _shift_id::text, true);
    UPDATE public.schedules SET published_shifts_snapshot=snap, last_status_changed_at=now(), last_status_changed_by=auth.uid(), last_status_action='updated' WHERE id=sc.id;
    PERFORM set_config('croo.marketplace_publish_shift', '', true);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._update_marketplace_publication(uuid) FROM PUBLIC, anon, authenticated;

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
    SELECT count(*) INTO v_n FROM public.scheduled_shifts s WHERE s.schedule_id = NEW.id AND NOT s.is_phantom;
    BEGIN
      INSERT INTO public.schedule_change_log (schedule_id, change_type, changed_by, is_draft, week_live, note)
      VALUES (NEW.id, 'withdrawn', auth.uid(), false, true, CASE WHEN v_n = 0 THEN 'Cleared' END);
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

CREATE OR REPLACE FUNCTION public.approve_shift_offer(_offer_id uuid, _claimer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF (g.o).status = 'approved' AND (g.o).claimed_by_user_id = _claimer_id AND g.owner_id = _claimer_id THEN
    PERFORM public._update_marketplace_publication(g.shift_id); RETURN;
  END IF;
  IF public._shift_has_started(g.shift_id) THEN RAISE EXCEPTION 'This shift has already started'; END IF;
  IF (g.o).status NOT IN ('available','claimed') THEN RAISE EXCEPTION 'This shift is no longer open'; END IF;
  IF g.owner_id IS DISTINCT FROM (g.o).offered_by_user_id THEN RAISE EXCEPTION 'The shift changed since it was offered'; END IF;
  IF NOT EXISTS (SELECT 1 FROM shift_offer_claims WHERE shift_offer_id = _offer_id AND user_id = _claimer_id) THEN RAISE EXCEPTION 'That person has no pending claim'; END IF;
  UPDATE shift_offers SET status = 'approved', claimed_by_user_id = _claimer_id, approved_at = now(), approved_by_user_id = auth.uid(), approved_via = 'approve', updated_at = now() WHERE id = _offer_id;
  UPDATE scheduled_shifts SET user_id = _claimer_id WHERE id = g.shift_id;
  PERFORM public._update_marketplace_publication(g.shift_id);
END $$;

CREATE OR REPLACE FUNCTION public.assign_shift_offer(_offer_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF (g.o).status = 'approved' AND (g.o).claimed_by_user_id = _user_id AND g.owner_id = _user_id THEN
    PERFORM public._update_marketplace_publication(g.shift_id); RETURN;
  END IF;
  IF public._shift_has_started(g.shift_id) THEN RAISE EXCEPTION 'This shift has already started'; END IF;
  IF (g.o).status NOT IN ('available','claimed') THEN RAISE EXCEPTION 'This shift is no longer open'; END IF;
  IF g.owner_id IS DISTINCT FROM (g.o).offered_by_user_id THEN RAISE EXCEPTION 'The shift changed since it was offered'; END IF;
  IF _user_id = g.owner_id THEN RAISE EXCEPTION 'That person already has this shift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_locations WHERE user_id = _user_id AND location_id = g.loc) THEN RAISE EXCEPTION 'That person is not at this store'; END IF;
  PERFORM set_config('croo.shift_offer_assign', '1', true);
  INSERT INTO shift_offer_claims (shift_offer_id, user_id) VALUES (_offer_id, _user_id) ON CONFLICT (shift_offer_id, user_id) DO NOTHING;
  PERFORM set_config('croo.shift_offer_assign', '', true);
  UPDATE shift_offers SET status = 'approved', claimed_by_user_id = _user_id, approved_at = now(), approved_by_user_id = auth.uid(), approved_via = 'assign', updated_at = now() WHERE id = _offer_id;
  UPDATE scheduled_shifts SET user_id = _user_id WHERE id = g.shift_id;
  PERFORM public._update_marketplace_publication(g.shift_id);
END $$;

CREATE OR REPLACE FUNCTION public.undo_shift_offer(_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record; nxt uuid;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF (g.o).status <> 'approved' OR (g.o).approved_at IS NULL OR (g.o).approved_at < now() - interval '10 minutes' THEN RAISE EXCEPTION 'Undo is no longer available'; END IF;
  IF g.owner_id IS DISTINCT FROM (g.o).claimed_by_user_id THEN RAISE EXCEPTION 'The shift changed since it was approved'; END IF;
  IF (g.o).approved_via = 'assign' THEN DELETE FROM shift_offer_claims WHERE shift_offer_id = _offer_id AND user_id = (g.o).claimed_by_user_id; END IF;
  UPDATE scheduled_shifts SET user_id = (g.o).offered_by_user_id WHERE id = g.shift_id;
  SELECT user_id INTO nxt FROM shift_offer_claims WHERE shift_offer_id = _offer_id ORDER BY created_at LIMIT 1;
  UPDATE shift_offers SET status = CASE WHEN nxt IS NULL THEN 'available' ELSE 'claimed' END, claimed_by_user_id = nxt, approved_at = NULL, approved_by_user_id = NULL, approved_via = NULL, updated_at = now() WHERE id = _offer_id;
  PERFORM public._update_marketplace_publication(g.shift_id);
END $$;
REVOKE ALL ON FUNCTION public.approve_shift_offer(uuid,uuid), public.assign_shift_offer(uuid,uuid), public.undo_shift_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_shift_offer(uuid,uuid), public.assign_shift_offer(uuid,uuid), public.undo_shift_offer(uuid) TO authenticated;