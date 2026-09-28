DO $m$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.payroll_hours(uuid,date,date)'::regprocedure) INTO d;
  IF position('wage_missing := wage IS NULL OR wage <= 0;' in d) = 0 THEN
    RAISE EXCEPTION 'payroll_hours live definition differs; aborting';
  END IF;
  EXECUTE replace(d, 'wage_missing := wage IS NULL OR wage <= 0;', 'wage_missing := wage IS NULL;');
END $m$;