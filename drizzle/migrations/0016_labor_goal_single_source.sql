ALTER TABLE public.week_templates
  ADD COLUMN weekly_labor_percentage_target numeric NULL CHECK (weekly_labor_percentage_target > 0 AND weekly_labor_percentage_target <= 100),
  ADD COLUMN is_store_goal boolean NOT NULL DEFAULT false;
UPDATE public.week_templates w SET is_store_goal = true
WHERE w.location_id IS NOT NULL AND w.id = (
  SELECT w2.id FROM public.week_templates w2 WHERE w2.location_id = w.location_id
  ORDER BY w2.updated_at DESC, w2.created_at DESC, w2.id LIMIT 1);
CREATE UNIQUE INDEX week_templates_one_store_goal ON public.week_templates (location_id) WHERE is_store_goal;

-- day_of_week convention: 0 = Monday … 6 = Sunday (WeekTemplateBuilder).
CREATE OR REPLACE FUNCTION public._labor_goal_caller_ok(_location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres','service_role')
      OR (auth.uid() IS NOT NULL AND public.has_location_access(auth.uid(), _location_id))
$$;
REVOKE EXECUTE ON FUNCTION public._labor_goal_caller_ok(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.labor_goals(_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; store_default numeric; days jsonb := '{}'::jsonb; i int;
BEGIN
  IF NOT public._labor_goal_caller_ok(_location_id) THEN RETURN NULL; END IF;
  SELECT labor_percentage_target INTO store_default FROM public.location_settings WHERE location_id = _location_id;
  store_default := coalesce(store_default, 25);
  SELECT id, template_name, weekly_labor_percentage_target INTO t
    FROM public.week_templates WHERE location_id = _location_id AND is_store_goal;
  FOR i IN 0..6 LOOP
    days := days || jsonb_build_object(i::text, (SELECT ds.labor_percentage_target FROM public.week_template_day_settings ds
      WHERE ds.week_template_id = t.id AND ds.day_of_week = i));
  END LOOP;
  RETURN jsonb_build_object(
    'weekly', coalesce(t.weekly_labor_percentage_target, store_default),
    'weekly_source', CASE WHEN t.weekly_labor_percentage_target IS NOT NULL THEN 'weekly_goal' ELSE 'store_default' END,
    'store_default', store_default,
    'days', days, 'template_id', t.id, 'template_name', t.template_name);
END $$;

CREATE OR REPLACE FUNCTION public.labor_goal_pct(_location_id uuid, _date date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g jsonb;
BEGIN
  g := public.labor_goals(_location_id);
  IF g IS NULL THEN RETURN NULL; END IF;
  IF _date IS NOT NULL AND g->'days'->>((extract(isodow FROM _date)::int - 1)::text) IS NOT NULL THEN
    RETURN (g->'days'->>((extract(isodow FROM _date)::int - 1)::text))::numeric;
  END IF;
  RETURN (g->>'weekly')::numeric;
END $$;

CREATE OR REPLACE FUNCTION public.set_labor_goal(_location_id uuid, _day_of_week int DEFAULT NULL, _pct numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'manager')
     OR NOT public.has_location_access(auth.uid(), _location_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF _pct IS NOT NULL AND NOT (_pct > 0 AND _pct <= 100) THEN RAISE EXCEPTION 'Goal must be between 0 and 100'; END IF;
  IF _day_of_week IS NOT NULL AND _day_of_week NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'Bad weekday'; END IF;
  SELECT id INTO tid FROM public.week_templates WHERE location_id = _location_id AND is_store_goal FOR UPDATE;
  IF tid IS NULL THEN
    INSERT INTO public.week_templates (template_name, location_id, created_by, is_store_goal)
      VALUES ('Weekly Template', _location_id, auth.uid(), true) RETURNING id INTO tid;
  END IF;
  IF _day_of_week IS NULL THEN
    UPDATE public.week_templates SET weekly_labor_percentage_target = _pct, updated_at = now() WHERE id = tid;
  ELSE
    INSERT INTO public.week_template_day_settings (week_template_id, day_of_week, labor_percentage_target)
      VALUES (tid, _day_of_week, _pct)
      ON CONFLICT (week_template_id, day_of_week)
      DO UPDATE SET labor_percentage_target = EXCLUDED.labor_percentage_target, updated_at = now();
  END IF;
  RETURN public.labor_goals(_location_id);
END $$;

CREATE OR REPLACE FUNCTION public.set_store_goal_template(_template_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE loc uuid;
BEGIN
  SELECT location_id INTO loc FROM public.week_templates WHERE id = _template_id;
  IF loc IS NULL OR auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'manager')
     OR NOT public.has_location_access(auth.uid(), loc) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.week_templates SET is_store_goal = false WHERE location_id = loc AND is_store_goal AND id <> _template_id;
  UPDATE public.week_templates SET is_store_goal = true WHERE id = _template_id;
  RETURN public.labor_goals(loc);
END $$;

REVOKE EXECUTE ON FUNCTION public.labor_goals(uuid), public.labor_goal_pct(uuid, date),
  public.set_labor_goal(uuid, int, numeric), public.set_store_goal_template(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_goals(uuid), public.labor_goal_pct(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_labor_goal(uuid, int, numeric), public.set_store_goal_template(uuid) TO authenticated;