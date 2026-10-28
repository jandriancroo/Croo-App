-- Wage privacy regression checks. Run with the database query tool; every row must say PASS.
-- Signed-in app users (authenticated) must never read individual wages directly or run the blended-rate helper.
WITH checks AS (
  SELECT 'authenticated cannot select profiles.hourly_wage' AS name,
         NOT has_column_privilege('authenticated', 'public.profiles', 'hourly_wage', 'SELECT') AS ok
  UNION ALL
  SELECT 'anon cannot select profiles.hourly_wage',
         NOT has_column_privilege('anon', 'public.profiles', 'hourly_wage', 'SELECT')
  UNION ALL
  SELECT 'authenticated cannot select labor_cache.employee_breakdown',
         NOT has_column_privilege('authenticated', 'public.labor_cache', 'employee_breakdown', 'SELECT')
  UNION ALL
  SELECT 'authenticated cannot execute store_blended_rate',
         NOT has_function_privilege('authenticated', 'public.store_blended_rate(uuid, date)', 'EXECUTE')
  UNION ALL
  SELECT 'anon cannot execute store_blended_rate',
         NOT has_function_privilege('anon', 'public.store_blended_rate(uuid, date)', 'EXECUTE')
  UNION ALL
  SELECT 'labor_insights blocks scheduling_manager (restrictive policy present)',
         EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'labor_insights'
                  AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND qual ILIKE '%scheduling_manager%')
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM checks;
