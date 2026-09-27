-- Package A step 1: schema
ALTER TABLE public.labor_rules
  ADD COLUMN max_open_shift_hours numeric NOT NULL DEFAULT 16,
  ADD COLUMN duplicate_tap_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN auto_clock_out_after_close_min integer NOT NULL DEFAULT 180;

ALTER TABLE public.labor_shift_resolutions
  ADD COLUMN resolution text NOT NULL DEFAULT 'zero'
  CHECK (resolution IN ('zero','auto_reviewed'));

CREATE TABLE public.location_timezone_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'timezone_change' CHECK (kind IN ('timezone_change','parse_failed')),
  address text,
  derived_state text,
  current_tz text,
  proposed_tz text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.location_timezone_pending TO authenticated;
GRANT ALL ON public.location_timezone_pending TO service_role;
REVOKE ALL ON public.location_timezone_pending FROM anon;
ALTER TABLE public.location_timezone_pending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins can view pending timezones" ON public.location_timezone_pending
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE POLICY "Super admins can update pending timezones" ON public.location_timezone_pending
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE TRIGGER update_location_timezone_pending_updated_at BEFORE UPDATE ON public.location_timezone_pending
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Address -> (state, timezone)
CREATE OR REPLACE FUNCTION public.derive_store_region(address text)
RETURNS TABLE(state_code text, timezone text)
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  a text; m text[]; st text; zip text; z3 int; r record;
BEGIN
  IF address IS NULL OR btrim(address) = '' THEN RETURN; END IF;
  a := upper(regexp_replace(address, '[\r\n\t]+', ' ', 'g'));
  a := btrim(regexp_replace(a, '\s+', ' ', 'g'));
  a := regexp_replace(a, '(,|\.|\s)*(USA|UNITED STATES)\s*$', '');

  CREATE TEMP TABLE IF NOT EXISTS _pka_states(code text, name text, tz text) ON COMMIT DROP;
  IF NOT EXISTS (SELECT 1 FROM _pka_states) THEN
    INSERT INTO _pka_states VALUES
    ('AL','ALABAMA','America/Chicago'),('AK','ALASKA','America/Anchorage'),('AZ','ARIZONA','America/Phoenix'),
    ('AR','ARKANSAS','America/Chicago'),('CA','CALIFORNIA','America/Los_Angeles'),('CO','COLORADO','America/Denver'),
    ('CT','CONNECTICUT','America/New_York'),('DE','DELAWARE','America/New_York'),('DC','DISTRICT OF COLUMBIA','America/New_York'),
    ('FL','FLORIDA','America/New_York'),('GA','GEORGIA','America/New_York'),('HI','HAWAII','Pacific/Honolulu'),
    ('ID','IDAHO','America/Boise'),('IL','ILLINOIS','America/Chicago'),('IN','INDIANA','America/Indiana/Indianapolis'),
    ('IA','IOWA','America/Chicago'),('KS','KANSAS','America/Chicago'),('KY','KENTUCKY','America/New_York'),
    ('LA','LOUISIANA','America/Chicago'),('ME','MAINE','America/New_York'),('MD','MARYLAND','America/New_York'),
    ('MA','MASSACHUSETTS','America/New_York'),('MI','MICHIGAN','America/Detroit'),('MN','MINNESOTA','America/Chicago'),
    ('MS','MISSISSIPPI','America/Chicago'),('MO','MISSOURI','America/Chicago'),('MT','MONTANA','America/Denver'),
    ('NE','NEBRASKA','America/Chicago'),('NV','NEVADA','America/Los_Angeles'),('NH','NEW HAMPSHIRE','America/New_York'),
    ('NJ','NEW JERSEY','America/New_York'),('NM','NEW MEXICO','America/Denver'),('NY','NEW YORK','America/New_York'),
    ('NC','NORTH CAROLINA','America/New_York'),('ND','NORTH DAKOTA','America/Chicago'),('OH','OHIO','America/New_York'),
    ('OK','OKLAHOMA','America/Chicago'),('OR','OREGON','America/Los_Angeles'),('PA','PENNSYLVANIA','America/New_York'),
    ('RI','RHODE ISLAND','America/New_York'),('SC','SOUTH CAROLINA','America/New_York'),('SD','SOUTH DAKOTA','America/Chicago'),
    ('TN','TENNESSEE','America/Chicago'),('TX','TEXAS','America/Chicago'),('UT','UTAH','America/Denver'),
    ('VT','VERMONT','America/New_York'),('VA','VIRGINIA','America/New_York'),('WA','WASHINGTON','America/Los_Angeles'),
    ('WV','WEST VIRGINIA','America/New_York'),('WI','WISCONSIN','America/Chicago'),('WY','WYOMING','America/Denver');
  END IF;

  -- 2-letter code before an optional ZIP, at the end ("CA 92545", "CA.92802", ", TX")
  m := regexp_match(a, '(?:^|[^A-Z])([A-Z]{2})[\s.,]*(\d{5})(?:-\d{4})?\s*$');
  IF m IS NOT NULL AND EXISTS (SELECT 1 FROM _pka_states s WHERE s.code = m[1]) THEN
    st := m[1]; zip := m[2];
  ELSE
    m := regexp_match(a, '(?:^|[^A-Z])([A-Z]{2})\s*$');
    IF m IS NOT NULL AND EXISTS (SELECT 1 FROM _pka_states s WHERE s.code = m[1]) THEN
      st := m[1];
    END IF;
  END IF;
  -- Full state name at the end ("RENO, NEVADA 89502"); longest names first.
  IF st IS NULL THEN
    FOR r IN SELECT s.code, s.name FROM _pka_states s ORDER BY length(s.name) DESC LOOP
      m := regexp_match(a, '(?:^|[^A-Z])' || r.name || '[\s.,]*(\d{5})?(?:-\d{4})?\s*$');
      IF m IS NOT NULL THEN st := r.code; zip := m[1]; EXIT; END IF;
    END LOOP;
  END IF;
  IF st IS NULL THEN RETURN; END IF;
  IF zip IS NULL THEN
    m := regexp_match(a, '(\d{5})(?:-\d{4})?\s*$');
    IF m IS NOT NULL THEN zip := m[1]; END IF;
  END IF;

  state_code := st;
  SELECT s.tz INTO timezone FROM _pka_states s WHERE s.code = st;
  IF zip IS NOT NULL THEN
    z3 := substr(zip, 1, 3)::int;
    timezone := CASE
      WHEN st = 'IN' AND substr(zip,1,2) IN ('46','47') THEN 'America/Indiana/Indianapolis'
      WHEN st = 'TX' AND z3 BETWEEN 798 AND 799 THEN 'America/Denver'
      WHEN st = 'FL' AND z3 BETWEEN 324 AND 325 THEN 'America/Chicago'
      WHEN st = 'TN' AND (z3 BETWEEN 373 AND 374 OR z3 BETWEEN 376 AND 379) THEN 'America/New_York'
      WHEN st = 'KY' AND z3 BETWEEN 420 AND 424 THEN 'America/Chicago'
      WHEN st = 'MI' AND z3 = 498 THEN 'America/Menominee'
      WHEN st = 'ID' AND z3 BETWEEN 835 AND 838 THEN 'America/Los_Angeles'
      WHEN st = 'OR' AND z3 = 979 THEN 'America/Boise'
      WHEN st = 'ND' AND z3 = 586 THEN 'America/Denver'
      WHEN st = 'SD' AND z3 BETWEEN 577 AND 577 THEN 'America/Denver'
      WHEN st = 'NE' AND z3 BETWEEN 690 AND 693 THEN 'America/Denver'
      WHEN st = 'KS' AND z3 = 678 THEN 'America/Denver'
      ELSE timezone END;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.derive_store_region(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_store_region(text) TO service_role;

-- A3: estimated end of a shift with no clock-out
CREATE OR REPLACE FUNCTION public.labor_estimated_end(_clock_in_punch_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ci timestamptz; v_uid uuid; v_loc uuid; v_tz text;
  v_maxh numeric := 16; v_close_min int := 180; v_dup int := 5;
  v_next timestamptz; v_last timestamptz; v_sched timestamptz; v_close timestamptz;
  v_bd date; v_open time; v_cl time; v_isclosed boolean;
  v_est timestamptz;
BEGIN
  SELECT tp.punch_time, tp.user_id, tp.location_id INTO v_ci, v_uid, v_loc
    FROM public.time_punches tp WHERE tp.id = _clock_in_punch_id AND tp.punch_type = 'clock_in';
  IF v_ci IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(lr.max_open_shift_hours, 16), coalesce(lr.auto_clock_out_after_close_min, 180), coalesce(lr.duplicate_tap_minutes, 5)
    INTO v_maxh, v_close_min, v_dup
    FROM public.labor_rules lr WHERE lr.location_id = v_loc ORDER BY lr.created_at LIMIT 1;
  v_maxh := coalesce(v_maxh, 16); v_close_min := coalesce(v_close_min, 180); v_dup := coalesce(v_dup, 5);
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = v_loc;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');

  -- Next shift start (a clock_in beyond the double-tap window).
  SELECT min(tp.punch_time) INTO v_next FROM public.time_punches tp
   WHERE tp.location_id = v_loc AND tp.user_id = v_uid AND tp.punch_type = 'clock_in'
     AND tp.punch_time > v_ci + make_interval(mins => v_dup);

  -- Last punch inside this shift.
  SELECT max(tp.punch_time) INTO v_last FROM public.time_punches tp
   WHERE tp.location_id = v_loc AND tp.user_id = v_uid
     AND tp.punch_time >= v_ci AND (v_next IS NULL OR tp.punch_time < v_next);

  -- Covering scheduled shift at this store: nearest start to the clock-in.
  SELECT x.e INTO v_sched FROM (
    SELECT ((ss.shift_date + ss.end_time) AT TIME ZONE v_tz)
             + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END AS e,
           abs(extract(epoch FROM ((ss.shift_date + ss.start_time) AT TIME ZONE v_tz) - v_ci)) AS dist
      FROM public.scheduled_shifts ss JOIN public.schedules s ON s.id = ss.schedule_id
     WHERE s.location_id = v_loc AND ss.user_id = v_uid AND NOT coalesce(ss.is_time_off, false)
       AND ss.shift_date BETWEEN (v_ci AT TIME ZONE v_tz)::date - 1 AND (v_ci AT TIME ZONE v_tz)::date + 1
  ) x ORDER BY x.dist LIMIT 1;

  -- Store close for the shift's business date (Sunday = 0).
  v_bd := public.business_date(v_loc, v_ci);
  SELECT lh.open_time, lh.close_time, lh.is_closed INTO v_open, v_cl, v_isclosed
    FROM public.location_hours lh WHERE lh.location_id = v_loc AND lh.day_of_week = extract(dow FROM v_bd)::int
    LIMIT 1;
  IF v_cl IS NOT NULL AND NOT coalesce(v_isclosed, false) THEN
    v_close := ((v_bd + v_cl) AT TIME ZONE v_tz)
               + CASE WHEN v_open IS NOT NULL AND v_cl <= v_open THEN interval '1 day' ELSE interval '0' END;
  END IF;

  v_est := least(v_next,
                 v_sched + interval '1 hour',
                 v_close + make_interval(mins => v_close_min),
                 v_ci + make_interval(secs => (v_maxh * 3600)::double precision));
  v_est := greatest(v_est, v_last);
  v_est := least(v_est, now());
  RETURN v_est;
END;
$$;
REVOKE ALL ON FUNCTION public.labor_estimated_end(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_estimated_end(uuid) TO service_role;