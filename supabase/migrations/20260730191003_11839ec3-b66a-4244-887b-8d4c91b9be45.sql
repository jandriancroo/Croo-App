REVOKE ALL ON public.croo_ai_briefings FROM anon;
REVOKE ALL ON public.daily_summary_logs FROM anon;
REVOKE ALL ON public.croo_cash_transactions FROM anon;

GRANT SELECT ON public.croo_ai_briefings TO authenticated;
GRANT SELECT ON public.daily_summary_logs TO authenticated;
GRANT SELECT, INSERT ON public.croo_cash_transactions TO authenticated;

GRANT ALL ON public.croo_ai_briefings TO service_role;
GRANT ALL ON public.daily_summary_logs TO service_role;
GRANT ALL ON public.croo_cash_transactions TO service_role;