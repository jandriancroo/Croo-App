-- Smart Close position layer (additive). New 'position' habit scope; person layer becomes relative
-- to the person's position. Live use is gated by labor_smart_close_settings.use_position (default off).

ALTER TABLE public.labor_smart_close_settings ADD COLUMN use_position boolean NOT NULL DEFAULT false;

-- Habits: add position scope (rolling 8 weeks, store-relative, trust n/(n+8)).
CREATE OR REPLACE FUNCTION public._labor_close_habits_compute(_location_id uuid, _as_of date)
RETURNS TABLE(scope text, key text, n int, avg_minutes numeric, trust numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (
    SELECT o.* FROM public.labor_shift_outcomes o
     WHERE o.location_id = _location_id AND o.is_closer AND o.exclude_reason IS NULL
       AND o.business_date < _as_of AND o.business_date >= _as_of - 365),
  st AS (SELECT count(*)::int AS n, avg(minutes_vs_schedule)::numeric AS a FROM c WHERE business_date >= _as_of - 56)
  SELECT 'store', 'all', st.n, round(st.a, 2), 1::numeric FROM st WHERE st.n > 0
  UNION ALL
  SELECT 'weekday', c.day_of_week::text, count(*)::int, round(avg(c.minutes_vs_schedule) - st.a, 2), round(count(*)::numeric / (count(*) + 8), 4)
    FROM c, st WHERE st.n > 0 AND c.business_date >= _as_of - 56 GROUP BY c.day_of_week, st.a
  UNION ALL
  SELECT 'sales_band', c.sales_band, count(*)::int,
         round(sum(c.minutes_vs_schedule * power(0.5, (_as_of - c.business_date) / 90.0)) / sum(power(0.5, (_as_of - c.business_date) / 90.0)) - st.a, 2),
         round(count(*)::numeric / (count(*) + 8), 4)
    FROM c, st WHERE st.n > 0 AND c.sales_band IS NOT NULL GROUP BY c.sales_band, st.a
  UNION ALL
  SELECT 'position', c.position, count(*)::int, round(avg(c.minutes_vs_schedule) - st.a, 2), round(count(*)::numeric / (count(*) + 8), 4)
    FROM c, st WHERE st.n > 0 AND c.position IS NOT NULL AND c.business_date >= _as_of - 56 GROUP BY c.position, st.a
  UNION ALL
  SELECT 'person', p.user_id::text, count(*)::int, round(avg(p.minutes_vs_schedule) - st.a, 2), round(count(*)::numeric / (count(*) + 8), 4)
    FROM (SELECT c.user_id, c.minutes_vs_schedule, row_number() OVER (PARTITION BY c.user_id ORDER BY c.business_date DESC) AS rn FROM c) p, st
   WHERE st.n > 0 AND p.rn <= 30 GROUP BY p.user_id, st.a
$$;

-- Prediction: store + weekday*t + band*t + position*t + (person - position)*t_person.
-- _use_position false (or no position habit) behaves exactly like the 3-layer version.
CREATE OR REPLACE FUNCTION public._labor_close_predict_min(_location_id uuid, _user_id uuid, _dow int, _band text,
  _position text DEFAULT NULL, _as_of date DEFAULT NULL, _use_position boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v numeric; v_pos numeric := 0;
BEGIN
  IF _as_of IS NULL THEN
    SELECT CASE WHEN bool_or(h.scope = 'store')
                THEN sum(CASE WHEN h.scope = 'store' THEN h.avg_minutes
                              WHEN h.scope = 'person' AND _use_position THEN (h.avg_minutes - v_pos) * h.trust
                              ELSE h.avg_minutes * h.trust END) END
      INTO v FROM public.labor_close_habits h
     WHERE h.location_id = _location_id
       AND ((h.scope = 'store') OR (h.scope = 'weekday' AND h.key = _dow::text)
            OR (h.scope = 'sales_band' AND h.key = _band) OR (h.scope = 'person' AND h.key = _user_id::text)
            OR (_use_position AND h.scope = 'position' AND h.key = _position));
    IF _use_position AND _position IS NOT NULL THEN
      SELECT coalesce(h.avg_minutes, 0) * h.trust INTO v_pos FROM public.labor_close_habits h
       WHERE h.location_id = _location_id AND h.scope = 'position' AND h.key = _position;
      v_pos := coalesce(v_pos, 0);
    END IF;
  ELSE
    SELECT CASE WHEN bool_or(h.scope = 'store')
                THEN sum(CASE WHEN h.scope = 'store' THEN h.avg_minutes
                              WHEN h.scope = 'person' AND _use_position THEN (h.avg_minutes - v_pos) * h.trust
                              ELSE h.avg_minutes * h.trust END) END
      INTO v FROM public._labor_close_habits_compute(_location_id, _as_of) h
     WHERE (h.scope = 'store') OR (h.scope = 'weekday' AND h.key = _dow::text)
        OR (h.scope = 'sales_band' AND h.key = _band) OR (h.scope = 'person' AND h.key = _user_id::text)
        OR (_use_position AND h.scope = 'position' AND h.key = _position);
    IF _use_position AND _position IS NOT NULL THEN
      SELECT coalesce(h.avg_minutes, 0) * h.trust INTO v_pos FROM public._labor_close_habits_compute(_location_id, _as_of) h
       WHERE h.scope = 'position' AND h.key = _position;
      v_pos := coalesce(v_pos, 0);
    END IF;
  END IF;
  RETURN v;
END $$;