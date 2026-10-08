ALTER TYPE public.visual_alert_type ADD VALUE IF NOT EXISTS 'labor_rules_proposal';

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
    d := NULL;
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
  UPDATE public.visual_alert_queue SET seen_at = now()
   WHERE notification_id = 'labor-rules:' || _proposal_id::text AND seen_at IS NULL;
  RETURN v_res;
END $$;

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
  UPDATE public.visual_alert_queue SET seen_at = now()
   WHERE notification_id = 'labor-rules:' || _proposal_id::text AND seen_at IS NULL;
  RETURN v_p;
END $$;

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

  UPDATE public.visual_alert_queue q SET seen_at = now()
    FROM public.labor_rule_proposals p
   WHERE p.location_id = _location_id AND p.status = 'pending'
     AND q.notification_id = 'labor-rules:' || p.id::text AND q.seen_at IS NULL;
  UPDATE public.labor_rule_proposals SET status = 'expired'
   WHERE location_id = _location_id AND status = 'pending';

  INSERT INTO public.labor_rule_proposals (location_id, kind, status, state_code, diff, sources, notes, model, created_by)
  VALUES (_location_id, _kind, CASE WHEN jsonb_array_length(v_diff) > 0 THEN 'pending' ELSE 'no_changes' END,
          _state_code, v_diff, coalesce(_sources, '[]'::jsonb), _notes, _model, _created_by)
  RETURNING * INTO v_res;
  RETURN v_res;
END $$;