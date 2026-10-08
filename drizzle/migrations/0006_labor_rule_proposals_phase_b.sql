REVOKE EXECUTE ON FUNCTION public._can_manage_labor_rules(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._can_manage_labor_rules(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._can_approve_labor_rules(_user uuid, _location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _user IS NOT NULL AND (public.is_super_admin(_user) OR EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = _location_id AND public.is_org_admin(_user, l.organization_id)));
$$;
REVOKE EXECUTE ON FUNCTION public._can_approve_labor_rules(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._can_approve_labor_rules(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.my_labor_rules_access(_location_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'can_view', coalesce(public.has_location_access(auth.uid(), _location_id), false),
    'can_check', coalesce(public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), _location_id), false),
    'can_edit', coalesce(public._can_manage_labor_rules(auth.uid(), _location_id), false),
    'can_approve', coalesce(public._can_approve_labor_rules(auth.uid(), _location_id), false));
$$;
REVOKE EXECUTE ON FUNCTION public.my_labor_rules_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_labor_rules_access(uuid) TO authenticated, service_role;

-- One validator
CREATE OR REPLACE FUNCTION public._labor_rules_validate(_row public.labor_rules)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF _row.meal_break_hours IS NOT NULL AND (_row.meal_break_hours < 0 OR _row.meal_break_hours > 12) THEN
    RAISE EXCEPTION 'meal_break_hours must be 0-12' USING ERRCODE = '22023'; END IF;
  IF _row.meal_break_duration IS NOT NULL AND (_row.meal_break_duration < 10 OR _row.meal_break_duration > 60) THEN
    RAISE EXCEPTION 'meal_break_duration must be 10-60' USING ERRCODE = '22023'; END IF;
  IF coalesce(_row.daily_overtime_threshold, 0) > 0 AND coalesce(_row.daily_double_time_threshold, 0) > 0
     AND _row.daily_double_time_threshold <= _row.daily_overtime_threshold THEN
    RAISE EXCEPTION 'daily_double_time_threshold must be above daily_overtime_threshold' USING ERRCODE = '22023'; END IF;
  IF _row.meal_waiver_max_hours IS NOT NULL AND _row.meal_break_hours IS NOT NULL
     AND _row.meal_waiver_max_hours < _row.meal_break_hours THEN
    RAISE EXCEPTION 'meal_waiver_max_hours must be >= meal_break_hours' USING ERRCODE = '22023'; END IF;
  IF _row.meal_deadline_hours IS NOT NULL AND _row.meal_break_hours IS NOT NULL
     AND _row.meal_deadline_hours > _row.meal_break_hours THEN
    RAISE EXCEPTION 'meal_deadline_hours must be <= meal_break_hours' USING ERRCODE = '22023'; END IF;
  IF (_row.overtime_multiplier IS NOT NULL AND (_row.overtime_multiplier < 1 OR _row.overtime_multiplier > 3))
     OR (_row.double_time_multiplier IS NOT NULL AND (_row.double_time_multiplier < 1 OR _row.double_time_multiplier > 3)) THEN
    RAISE EXCEPTION 'multipliers must be 1-3' USING ERRCODE = '22023'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public._labor_rules_validate(public.labor_rules) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_rules_validate(public.labor_rules) TO service_role;

DROP FUNCTION public.save_labor_rules(uuid, jsonb, text, uuid, text);
CREATE FUNCTION public.save_labor_rules(_location_id uuid, _patch jsonb, _source text, _proposal_id uuid DEFAULT NULL,
  _note text DEFAULT NULL, _citations jsonb DEFAULT NULL)
RETURNS public.labor_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.labor_rules; v_new public.labor_rules; v_res public.labor_rules;
  v_created boolean := false; k text; v_set text := ''; v_fs jsonb; v_oj jsonb; v_nj jsonb; v_stamp jsonb;
  v_bad text[] := ARRAY['id','location_id','created_at','unpaid_break_min_minutes','duplicate_tap_minutes',
                        'max_open_shift_hours','auto_clock_out_after_close_min','field_sources'];
BEGIN
  IF _location_id IS NULL OR (coalesce(auth.role(), '') <> 'service_role'
     AND NOT public._can_manage_labor_rules(v_uid, _location_id)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _source IS NULL OR _source NOT IN ('manual','preset','migration','ai') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid patch' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF k = ANY (v_bad) THEN RAISE EXCEPTION 'field not editable: %', k USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                    AND c.table_name = 'labor_rules' AND c.column_name = k) THEN
      RAISE EXCEPTION 'unknown field: %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT * INTO v_old FROM public.labor_rules lr WHERE lr.location_id = _location_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.labor_rules (location_id, rule_name)
    VALUES (_location_id, coalesce(nullif(_patch->>'rule_name', ''), 'Labor Rules'))
    ON CONFLICT (location_id) DO NOTHING;
    SELECT * INTO v_old FROM public.labor_rules lr WHERE lr.location_id = _location_id FOR UPDATE;
    v_created := true;
  END IF;

  v_new := jsonb_populate_record(v_old, _patch);
  PERFORM public._labor_rules_validate(v_new);

  v_oj := to_jsonb(v_old); v_nj := to_jsonb(v_new);
  v_fs := coalesce(v_old.field_sources, '{}'::jsonb);
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF (v_oj->k) IS DISTINCT FROM (v_nj->k) OR v_created THEN
      v_set := v_set || format('%I = ($1).%I, ', k, k);
      v_stamp := jsonb_build_object('source', _source, 'at', now(), 'by', v_uid, 'proposal_id', _proposal_id);
      IF _citations IS NOT NULL AND jsonb_typeof(_citations) = 'object' AND _citations ? k THEN
        v_stamp := v_stamp || jsonb_build_object('citation', _citations->k);
      END IF;
      v_fs := v_fs || jsonb_build_object(k, v_stamp);
    END IF;
  END LOOP;

  v_set := v_set || 'field_sources = $2, updated_at = now()';
  IF _source = 'manual' THEN v_set := v_set || ', rules_reviewed_at = now(), rules_reviewed_by = $3'; END IF;
  IF _source = 'ai' THEN v_set := v_set || ', laws_checked_at = now()'; END IF;
  EXECUTE format('UPDATE public.labor_rules SET %s WHERE id = $4 RETURNING *', v_set)
    INTO v_res USING v_new, v_fs, v_uid, v_old.id;

  INSERT INTO public.labor_rules_history (location_id, changed_by, source, proposal_id, before, after, note)
  VALUES (_location_id, v_uid, _source, _proposal_id, CASE WHEN v_created THEN NULL ELSE v_oj END, to_jsonb(v_res), _note);
  RETURN v_res;
END $function$;
REVOKE EXECUTE ON FUNCTION public.save_labor_rules(uuid, jsonb, text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_labor_rules(uuid, jsonb, text, uuid, text, jsonb) TO authenticated, service_role;

-- Proposals table
CREATE TABLE public.labor_rule_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('build','recheck')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','declined','expired','no_changes','failed')),
  state_code text,
  diff jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text, model text, error text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  decided_by uuid, decided_at timestamptz, applied_fields text[], decision_note text
);
CREATE INDEX labor_rule_proposals_loc_created_idx ON public.labor_rule_proposals (location_id, created_at DESC);
CREATE UNIQUE INDEX labor_rule_proposals_one_pending ON public.labor_rule_proposals (location_id) WHERE status = 'pending';
GRANT SELECT ON public.labor_rule_proposals TO authenticated;
GRANT ALL ON public.labor_rule_proposals TO service_role;
ALTER TABLE public.labor_rule_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Store members can view labor rule proposals" ON public.labor_rule_proposals
  FOR SELECT TO authenticated USING (public.has_location_access(auth.uid(), location_id));

-- a) create
CREATE OR REPLACE FUNCTION public.create_labor_rule_proposal(_location_id uuid, _kind text, _state_code text,
  _suggested jsonb, _sources jsonb, _notes text, _model text, _created_by uuid)
RETURNS public.labor_rule_proposals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cur public.labor_rules; v_cj jsonb; v_try public.labor_rules; v_diff jsonb := '[]'::jsonb;
  k text; v jsonb; v_val jsonb; v_cit jsonb; v_host text; v_res public.labor_rule_proposals;
  v_bad text[] := ARRAY['id','location_id','created_at','updated_at','unpaid_break_min_minutes','duplicate_tap_minutes',
    'max_open_shift_hours','auto_clock_out_after_close_min','field_sources','allow_unscheduled_clock_in',
    'allow_early_clock_in','early_clock_in_minutes','rule_name','pay_period_type','pay_period_start_date',
    'auto_punch_out_time','meal_waiver_max_hours','second_meal_waiver_max_hours','rules_reviewed_at',
    'rules_reviewed_by','laws_checked_at'];
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('build','recheck') THEN RAISE EXCEPTION 'invalid kind' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = _location_id) THEN
    RAISE EXCEPTION 'unknown location' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_cur FROM public.labor_rules WHERE location_id = _location_id;
  IF NOT FOUND THEN v_cur := jsonb_populate_record(NULL::public.labor_rules, '{}'::jsonb); END IF;
  v_cj := to_jsonb(v_cur);

  IF _suggested IS NOT NULL AND jsonb_typeof(_suggested) = 'object' THEN
    FOR k, v IN SELECT * FROM jsonb_each(_suggested) LOOP
      CONTINUE WHEN k = ANY (v_bad);
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                                 AND c.table_name = 'labor_rules' AND c.column_name = k);
      CONTINUE WHEN jsonb_typeof(v) <> 'object' OR NOT (v ? 'value');
      v_val := v->'value'; v_cit := v->'citation';
      CONTINUE WHEN v_cit IS NULL OR jsonb_typeof(v_cit) <> 'object';
      v_host := lower(substring(coalesce(v_cit->>'url','') FROM '^https://([^/:?#]+)'));
      CONTINUE WHEN v_host IS NULL OR v_host !~ '\.(gov|us)$';
      CONTINUE WHEN (v_cj->k) IS NOT DISTINCT FROM v_val
                    OR ((v_cj->k) IS NULL AND v_val = 'null'::jsonb);
      BEGIN
        v_try := jsonb_populate_record(v_cur, jsonb_build_object(k, v_val));
        PERFORM public._labor_rules_validate(v_try);
      EXCEPTION WHEN OTHERS THEN CONTINUE;
      END;
      v_diff := v_diff || jsonb_build_array(jsonb_build_object(
        'field', k, 'current', coalesce(v_cj->k, 'null'::jsonb), 'suggested', to_jsonb(v_try)->k,
        'current_source', v_cur.field_sources->k->>'source',
        'citation', jsonb_build_object('url', v_cit->>'url', 'quote', v_cit->>'quote', 'state', v_cit->>'state'),
        'confidence', v->'confidence'));
    END LOOP;
  END IF;

  UPDATE public.labor_rule_proposals SET status = 'expired'
   WHERE location_id = _location_id AND status = 'pending';

  INSERT INTO public.labor_rule_proposals (location_id, kind, status, state_code, diff, sources, notes, model, created_by)
  VALUES (_location_id, _kind, CASE WHEN jsonb_array_length(v_diff) > 0 THEN 'pending' ELSE 'no_changes' END,
          _state_code, v_diff, coalesce(_sources, '[]'::jsonb), _notes, _model, _created_by)
  RETURNING * INTO v_res;
  RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_labor_rule_proposal(uuid, text, text, jsonb, jsonb, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_labor_rule_proposal(uuid, text, text, jsonb, jsonb, text, text, uuid) TO service_role;

-- b) failure
CREATE OR REPLACE FUNCTION public.record_labor_rule_check_failure(_location_id uuid, _kind text, _error text, _created_by uuid)
RETURNS public.labor_rule_proposals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_res public.labor_rule_proposals;
BEGIN
  INSERT INTO public.labor_rule_proposals (location_id, kind, status, error, created_by)
  VALUES (_location_id, _kind, 'failed', left(_error, 2000), _created_by) RETURNING * INTO v_res;
  RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_labor_rule_check_failure(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_labor_rule_check_failure(uuid, text, text, uuid) TO service_role;

-- c) approve
CREATE OR REPLACE FUNCTION public.approve_labor_rule_proposal(_proposal_id uuid, _fields text[], _note text DEFAULT NULL)
RETURNS public.labor_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p public.labor_rule_proposals; v_cj jsonb; f text; d jsonb; v_patch jsonb := '{}'::jsonb;
  v_cits jsonb := '{}'::jsonb; v_res public.labor_rules;
BEGIN
  SELECT * INTO v_p FROM public.labor_rule_proposals WHERE id = _proposal_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_approve_labor_rules(auth.uid(), v_p.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF v_p.status <> 'pending' OR v_p.expires_at <= now() THEN
    RAISE EXCEPTION 'This check is no longer open. Run a new check.' USING ERRCODE = '22023'; END IF;
  IF _fields IS NULL OR cardinality(_fields) = 0 THEN
    RAISE EXCEPTION 'Choose at least one change' USING ERRCODE = '22023'; END IF;
  SELECT to_jsonb(lr) INTO v_cj FROM public.labor_rules lr WHERE lr.location_id = v_p.location_id FOR UPDATE;
  FOREACH f IN ARRAY _fields LOOP
    SELECT e INTO d FROM jsonb_array_elements(v_p.diff) e WHERE e->>'field' = f LIMIT 1;
    IF d IS NULL THEN RAISE EXCEPTION 'field not in this check: %', f USING ERRCODE = '22023'; END IF;
    IF coalesce(v_cj->f, 'null'::jsonb) IS DISTINCT FROM coalesce(d->'current', 'null'::jsonb) THEN
      RAISE EXCEPTION 'Rules changed since this check. Run a new check.' USING ERRCODE = '40001'; END IF;
    v_patch := v_patch || jsonb_build_object(f, d->'suggested');
    v_cits := v_cits || jsonb_build_object(f, d->'citation');
  END LOOP;
  v_res := public.save_labor_rules(v_p.location_id, v_patch, 'ai', _proposal_id,
                                   coalesce(_note, 'Approved law update'), v_cits);
  UPDATE public.labor_rule_proposals SET status = 'applied', applied_fields = _fields,
    decided_by = auth.uid(), decided_at = now(), decision_note = _note WHERE id = _proposal_id;
  RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.approve_labor_rule_proposal(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_labor_rule_proposal(uuid, text[], text) TO authenticated, service_role;

-- d) decline
CREATE OR REPLACE FUNCTION public.decline_labor_rule_proposal(_proposal_id uuid, _note text DEFAULT NULL)
RETURNS public.labor_rule_proposals LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_p public.labor_rule_proposals;
BEGIN
  SELECT * INTO v_p FROM public.labor_rule_proposals WHERE id = _proposal_id FOR UPDATE;
  IF NOT FOUND OR NOT public._can_approve_labor_rules(auth.uid(), v_p.location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF v_p.status <> 'pending' THEN RAISE EXCEPTION 'This check is no longer open.' USING ERRCODE = '22023'; END IF;
  UPDATE public.labor_rule_proposals SET status = 'declined', decided_by = auth.uid(), decided_at = now(),
    decision_note = _note WHERE id = _proposal_id RETURNING * INTO v_p;
  RETURN v_p;
END $$;
REVOKE EXECUTE ON FUNCTION public.decline_labor_rule_proposal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_labor_rule_proposal(uuid, text) TO authenticated, service_role;

-- e) rate limit
CREATE OR REPLACE FUNCTION public.labor_rule_check_allowed(_location_id uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_last timestamptz;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.has_location_access(auth.uid(), _location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF _kind = 'build' THEN
    IF EXISTS (SELECT 1 FROM public.labor_rule_proposals WHERE location_id = _location_id) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'This store already had its setup check.', 'next_at', NULL); END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'next_at', NULL);
  ELSIF _kind = 'recheck' THEN
    SELECT max(created_at) INTO v_last FROM public.labor_rule_proposals
     WHERE location_id = _location_id AND status IN ('pending','applied','declined','no_changes','expired')
       AND created_at > now() - interval '24 hours';
    IF v_last IS NOT NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Checked in the last 24 hours.', 'next_at', v_last + interval '24 hours'); END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'next_at', NULL);
  END IF;
  RAISE EXCEPTION 'invalid kind' USING ERRCODE = '22023';
END $$;
REVOKE EXECUTE ON FUNCTION public.labor_rule_check_allowed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_rule_check_allowed(uuid, text) TO authenticated, service_role;