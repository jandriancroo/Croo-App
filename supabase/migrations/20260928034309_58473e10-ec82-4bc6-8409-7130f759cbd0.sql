CREATE TABLE public.pkgc_backup_functions AS
SELECT p.oid::regprocedure::text AS signature, md5(pg_get_functiondef(p.oid)) AS md5, pg_get_functiondef(p.oid) AS definition, p.proacl::text AS proacl, now() AS captured_at
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('labor_day_user_totals','labor_day_totals','labor_shifts','get_labor_totals_for_dates','get_live_labor_totals','get_cut_savings_total','queue_nightly_emails','send_hourly_sales_pulse','send_day_part_pulse','_store_labor','get_store_labor','_labor_totals_for_date');
CREATE TABLE public.pkgc_backup_sales_cache AS
SELECT location_id, sale_date, net_sales, hourly_data, yoy_sale_date, yoy_net_sales, yoy_hourly_data, pace_adjusted_projection FROM public.sales_cache WHERE sale_date >= current_date - 400;
CREATE TABLE public.pkgc_backup_labor_samples AS
SELECT l.id AS location_id, d::date AS d, (SELECT jsonb_agg(to_jsonb(s)) FROM public._store_labor(l.id, d::date, false) s) AS store_labor,
  (SELECT jsonb_agg(to_jsonb(u)) FROM public.labor_day_user_totals(l.id, d::date, false) u) AS user_totals
FROM public.locations l CROSS JOIN generate_series('2026-09-20'::date,'2026-09-27'::date,'1 day') d
WHERE l.id IN ('12c977c7-1786-4131-90f5-1eef3f96e2c6','01a87b8b-fb29-4734-8d1b-4a47307f843c','d667741f-6d4c-433e-bb22-307e817ea7f1','79456db0-c817-464e-a849-bca44f8d6f34','5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d');
ALTER TABLE public.pkgc_backup_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkgc_backup_sales_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkgc_backup_labor_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pkgc_backup_functions, public.pkgc_backup_sales_cache, public.pkgc_backup_labor_samples FROM PUBLIC, anon, authenticated;