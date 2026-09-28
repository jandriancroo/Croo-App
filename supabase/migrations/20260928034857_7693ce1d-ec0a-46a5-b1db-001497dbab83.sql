REVOKE ALL ON FUNCTION public.labor_shifts(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;
GRANT EXECUTE ON FUNCTION public.labor_shifts(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.labor_shifts(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.labor_shifts(uuid, date, date) TO sandbox_exec_lmodeiyrpwvgyqcvjkjr;