DO $mig$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname = 'check_alerts_sql' AND pronamespace = 'public'::regnamespace;
  IF src IS NULL THEN RAISE EXCEPTION 'check_alerts_sql not found'; END IF;
  IF position('s.is_published' in src) = 0 THEN
    src := replace(
      src,
      'AND s.week_end_date >= local_date::DATE',
      'AND s.week_end_date >= local_date::DATE
            AND s.is_published = true'
    );
    EXECUTE 'CREATE OR REPLACE FUNCTION public.check_alerts_sql() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' || quote_literal(src);
  END IF;
END
$mig$;