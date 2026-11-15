-- Rollback: DROP TRIGGER sales_cache_goal_guard ON public.sales_cache; DROP TRIGGER sales_cache_goal_override_audit ON public.sales_cache; DROP FUNCTION public.guard_sales_cache_goals(); DROP FUNCTION public.log_sales_goal_override();
-- Planning lock deferred: fetch-qubeyond-sales/index.ts:3120-3127 and
-- _shared/weekProjections.ts:284,299-306 can replace non-null zero/negative initial projections.

CREATE OR REPLACE FUNCTION public._can_override_goal(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _user_id IS NOT NULL AND public.has_role_or_higher(_user_id, 'manager')
$$;
REVOKE EXECUTE ON FUNCTION public._can_override_goal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_override_goal(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.sales_goal_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('set','change','clear')),
  old_value numeric(12,2),
  new_value numeric(12,2),
  living_at_change numeric(12,2),
  planning_value numeric(12,2),
  changed_by uuid,
  changed_by_role text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text,
  reason text
);
GRANT SELECT ON public.sales_goal_override_log TO authenticated;
GRANT ALL ON public.sales_goal_override_log TO service_role;
CREATE INDEX IF NOT EXISTS sales_goal_override_log_loc_date_idx ON public.sales_goal_override_log (location_id, sale_date, changed_at DESC);
ALTER TABLE public.sales_goal_override_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read override log for their locations" ON public.sales_goal_override_log
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id) AND public._can_override_goal(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.sales_goal_override_log FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.goal_engine_runs (
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  local_run_date date NOT NULL,
  source text NOT NULL DEFAULT 'tick',
  ran_at timestamptz NOT NULL DEFAULT now(),
  wrote_planning boolean NOT NULL DEFAULT false,
  window_start date, window_end date,
  week_adj numeric(6,4),
  days_written int,
  error text,
  PRIMARY KEY (location_id, local_run_date, source)
);
GRANT ALL ON public.goal_engine_runs TO service_role;
ALTER TABLE public.goal_engine_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goal_engine_runs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_sales_cache_goals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_claims text := NULLIF(current_setting('request.jwt.claims', true), '');
  v_role text := COALESCE(v_claims::jsonb->>'role', '');
  v_uid uuid := auth.uid();
  v_service boolean := v_claims IS NULL OR v_role = 'service_role';
  v_sys boolean; v_ovr boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_sys := NEW.initial_projection IS NOT NULL OR NEW.living_projection IS NOT NULL OR NEW.projected_sales IS NOT NULL;
    v_ovr := NEW.override_projection IS NOT NULL OR NEW.override_at IS NOT NULL OR NEW.override_by IS NOT NULL
             OR COALESCE(NEW.override_excluded_dates, '[]'::jsonb) <> '[]'::jsonb;
  ELSE
    v_sys := NEW.initial_projection IS DISTINCT FROM OLD.initial_projection
          OR NEW.living_projection IS DISTINCT FROM OLD.living_projection
          OR NEW.projected_sales IS DISTINCT FROM OLD.projected_sales;
    v_ovr := NEW.override_projection IS DISTINCT FROM OLD.override_projection
          OR NEW.override_at IS DISTINCT FROM OLD.override_at
          OR NEW.override_by IS DISTINCT FROM OLD.override_by
          OR NEW.override_excluded_dates IS DISTINCT FROM OLD.override_excluded_dates;
  END IF;
  IF NOT v_service THEN
    IF v_sys THEN
      RAISE EXCEPTION 'Planning/Living goals are system-managed' USING ERRCODE = '42501';
    END IF;
    IF v_ovr THEN
      IF NOT public._can_override_goal(v_uid) THEN
        RAISE EXCEPTION 'Only managers and above can change the daily goal' USING ERRCODE = '42501';
      END IF;
      IF NEW.sale_date < public.business_date(NEW.location_id) THEN
        RAISE EXCEPTION 'Past days are locked' USING ERRCODE = '42501';
      END IF;
      NEW.override_by := CASE WHEN NEW.override_projection IS NULL THEN NULL ELSE v_uid END;
      NEW.override_at := CASE WHEN NEW.override_projection IS NULL THEN NULL ELSE now() END;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_sales_cache_goals() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sales_cache_goal_guard ON public.sales_cache;
CREATE TRIGGER sales_cache_goal_guard
  BEFORE INSERT OR UPDATE OF initial_projection, living_projection, projected_sales,
         override_projection, override_at, override_by, override_excluded_dates
  ON public.sales_cache FOR EACH ROW EXECUTE FUNCTION public.guard_sales_cache_goals();

CREATE OR REPLACE FUNCTION public.log_sales_goal_override()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old numeric := CASE WHEN TG_OP = 'UPDATE' THEN OLD.override_projection END;
  v_claims text := NULLIF(current_setting('request.jwt.claims', true), '');
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.override_projection IS NOT DISTINCT FROM v_old THEN RETURN NULL; END IF;
  INSERT INTO public.sales_goal_override_log (location_id, sale_date, action, old_value, new_value,
    living_at_change, planning_value, changed_by, changed_by_role, source, reason)
  VALUES (NEW.location_id, NEW.sale_date,
    CASE WHEN NEW.override_projection IS NULL THEN 'clear' WHEN v_old IS NULL THEN 'set' ELSE 'change' END,
    v_old, NEW.override_projection, NEW.living_projection, NEW.initial_projection,
    v_uid, CASE WHEN v_uid IS NULL THEN NULL ELSE public.get_user_role(v_uid)::text END,
    CASE WHEN v_claims IS NULL OR COALESCE(v_claims::jsonb->>'role','') = 'service_role' THEN 'service'
         ELSE COALESCE(NULLIF(current_setting('croo.override_source', true), ''), 'direct') END,
    NULLIF(current_setting('croo.override_reason', true), ''));
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_sales_goal_override() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sales_cache_goal_override_audit ON public.sales_cache;
CREATE TRIGGER sales_cache_goal_override_audit
  AFTER INSERT OR UPDATE OF override_projection ON public.sales_cache
  FOR EACH ROW EXECUTE FUNCTION public.log_sales_goal_override();

CREATE OR REPLACE FUNCTION public.set_goal_override(_location_id uuid, _sale_date date, _value numeric,
  _excluded_dates jsonb DEFAULT '[]'::jsonb, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_src text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_location_access(auth.uid(), _location_id) OR NOT public._can_override_goal(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers and above can change the daily goal' USING ERRCODE = '42501';
  END IF;
  IF _sale_date < public.business_date(_location_id) THEN
    RAISE EXCEPTION 'Past days are locked' USING ERRCODE = '42501';
  END IF;
  SELECT pos_source INTO v_src FROM public.sales_cache WHERE location_id = _location_id ORDER BY sale_date DESC LIMIT 1;
  IF _value IS NULL OR _value <= 0 THEN RAISE EXCEPTION 'Goal must be greater than 0' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('croo.override_source', 'rpc', true);
  PERFORM set_config('croo.override_reason', COALESCE(_reason, ''), true);
  INSERT INTO public.sales_cache (location_id, sale_date, pos_source, override_projection, override_excluded_dates)
  VALUES (_location_id, _sale_date, COALESCE(v_src, 'qubeyond'), round(_value, 2), COALESCE(_excluded_dates, '[]'::jsonb))
  ON CONFLICT (location_id, sale_date) DO UPDATE
    SET override_projection = EXCLUDED.override_projection,
        override_excluded_dates = EXCLUDED.override_excluded_dates;
END $$;

CREATE OR REPLACE FUNCTION public.clear_goal_override(_location_id uuid, _sale_date date, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_location_access(auth.uid(), _location_id) OR NOT public._can_override_goal(auth.uid()) THEN
    RAISE EXCEPTION 'Only managers and above can change the daily goal' USING ERRCODE = '42501';
  END IF;
  IF _sale_date < public.business_date(_location_id) THEN
    RAISE EXCEPTION 'Past days are locked' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('croo.override_source', 'rpc', true);
  PERFORM set_config('croo.override_reason', COALESCE(_reason, ''), true);
  UPDATE public.sales_cache SET override_projection = NULL, override_at = NULL, override_by = NULL, override_excluded_dates = NULL
   WHERE location_id = _location_id AND sale_date = _sale_date;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_goal_override(uuid, date, numeric, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_goal_override(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_goal_override(uuid, date, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_goal_override(uuid, date, text) TO authenticated;
