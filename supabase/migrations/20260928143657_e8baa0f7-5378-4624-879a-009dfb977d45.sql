CREATE OR REPLACE FUNCTION public._payroll_classify(_shifts jsonb, _rules jsonb, _wage numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d_ot numeric := COALESCE((_rules->>'d_ot')::numeric,0);
  d_dt numeric := COALESCE((_rules->>'d_dt')::numeric,0);
  w_ot numeric := COALESCE((_rules->>'w_ot')::numeric,40);
  seventh boolean := COALESCE((_rules->>'seventh')::boolean,false);
  maxw numeric := NULLIF(_rules->>'max_wage','')::numeric;
  win text := COALESCE(_rules->>'window','business_day');
  wsdow int := COALESCE((_rules->>'wsdow')::int,1);
  daily_on boolean := NOT (maxw IS NOT NULL AND _wage IS NOT NULL AND _wage >= maxw);
  s record; wk record; dy record;
  w_start timestamptz; acc numeric := 0; p numeric; rest numeric; frac numeric;
  extra numeric; take numeric; res jsonb := '[]'::jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _pc_days(d date PRIMARY KEY, ws date, h numeric, ot numeric, dt numeric) ON COMMIT DROP;
  TRUNCATE _pc_days;
  INSERT INTO _pc_days
    SELECT (x->>'d')::date, (x->>'d')::date - ((extract(dow from (x->>'d')::date)::int - wsdow + 7) % 7),
           sum(COALESCE((x->>'h')::numeric,0)), 0, 0
    FROM jsonb_array_elements(COALESCE(_shifts,'[]')) x GROUP BY 1,2;
  DELETE FROM _pc_days WHERE h <= 0;

  IF daily_on AND d_ot > 0 THEN
    IF win = 'rolling_24h' THEN
      FOR s IN SELECT (x->>'d')::date d, (x->>'ci')::timestamptz ci,
                      COALESCE((x->>'co')::timestamptz, (x->>'ci')::timestamptz + make_interval(secs => ((x->>'h')::numeric*3600)::float8)) co,
                      COALESCE((x->>'h')::numeric,0) h
               FROM jsonb_array_elements(COALESCE(_shifts,'[]')) x
               WHERE COALESCE((x->>'h')::numeric,0) > 0 ORDER BY (x->>'ci')::timestamptz LOOP
        rest := s.h;
        IF w_start IS NULL OR s.ci >= w_start + interval '24 hours' THEN w_start := s.ci; acc := 0; END IF;
        WHILE rest > 0 LOOP
          IF s.co > w_start + interval '24 hours' AND s.co > s.ci THEN
            frac := GREATEST(0, LEAST(1, extract(epoch from (w_start + interval '24 hours' - GREATEST(s.ci, w_start))) / extract(epoch from (s.co - s.ci))));
            p := LEAST(rest, round(s.h * frac, 6));
          ELSE p := rest; END IF;
          UPDATE _pc_days SET ot = ot + (GREATEST(acc + p - d_ot,0) - GREATEST(acc - d_ot,0)) WHERE d = s.d;
          acc := acc + p; rest := rest - p;
          IF rest > 0 THEN w_start := w_start + interval '24 hours'; acc := 0; END IF;
        END LOOP;
      END LOOP;
    ELSE
      UPDATE _pc_days SET
        dt = CASE WHEN d_dt > 0 THEN GREATEST(h - d_dt, 0) ELSE 0 END,
        ot = GREATEST(CASE WHEN d_dt > 0 THEN LEAST(h, d_dt) ELSE h END - d_ot, 0)
      WHERE true;
    END IF;
  END IF;

  IF daily_on AND seventh THEN
    FOR wk IN SELECT ws, max(d) last_d FROM _pc_days GROUP BY ws HAVING count(*) = 7 LOOP
      UPDATE _pc_days SET ot = LEAST(h, 8), dt = GREATEST(h - 8, 0) WHERE d = wk.last_d;
    END LOOP;
  END IF;

  FOR wk IN SELECT ws, sum(h) tot, sum(ot) dot, sum(dt) ddt FROM _pc_days GROUP BY ws LOOP
    extra := GREATEST(GREATEST(wk.tot - wk.ddt - w_ot, 0) - wk.dot, 0);
    FOR dy IN SELECT d, h - ot - dt reg FROM _pc_days WHERE ws = wk.ws ORDER BY d DESC LOOP
      EXIT WHEN extra <= 0;
      take := LEAST(extra, GREATEST(dy.reg, 0));
      UPDATE _pc_days SET ot = ot + take WHERE d = dy.d;
      extra := extra - take;
    END LOOP;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'week_start', ws, 'hours', round(h,4),
           'reg', round(h-ot-dt,4), 'ot', round(ot,4), 'dt', round(dt,4)) ORDER BY d), '[]'::jsonb)
    INTO res FROM _pc_days;
  RETURN res;
END $function$;