-- Rollback: restore goal fields from sales_goal_legacy_backup_20261101 with croo.goal_backfill on; restore resolver definitions from 0043/0073.
SET LOCAL croo.goal_backfill = 'on';
LOCK TABLE public.sales_cache IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.sales_goal_legacy_backup_20261101 (
 location_id uuid NOT NULL, sale_date date NOT NULL, projected_sales numeric, initial_projection numeric, living_projection numeric, override_projection numeric, backed_up_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (location_id,sale_date)
);
GRANT ALL ON public.sales_goal_legacy_backup_20261101 TO service_role;
REVOKE ALL ON public.sales_goal_legacy_backup_20261101 FROM anon, authenticated;
ALTER TABLE public.sales_goal_legacy_backup_20261101 ENABLE ROW LEVEL SECURITY;
CREATE TEMP TABLE goal_totals_before ON COMMIT DROP AS SELECT location_id,date_trunc('month',sale_date) AS month, sum(coalesce(nullif(override_projection,0),living_projection,initial_projection,projected_sales,0)) AS goal FROM public.sales_cache WHERE sale_date >= '2025-01-01' GROUP BY 1,2;
INSERT INTO public.sales_goal_legacy_backup_20261101 (location_id,sale_date,projected_sales,initial_projection,living_projection,override_projection) SELECT location_id,sale_date,projected_sales,initial_projection,living_projection,override_projection FROM public.sales_cache WHERE projected_sales IS NOT NULL;
UPDATE public.sales_cache SET initial_projection = projected_sales WHERE initial_projection IS NULL AND living_projection IS NULL AND projected_sales IS NOT NULL;
UPDATE public.sales_cache SET projected_sales = NULL WHERE projected_sales IS NOT NULL;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM goal_totals_before b FULL JOIN (SELECT location_id,date_trunc('month',sale_date) AS month, sum(coalesce(nullif(override_projection,0),living_projection,initial_projection,0)) AS goal FROM public.sales_cache WHERE sale_date >= '2025-01-01' GROUP BY 1,2) a USING (location_id,month) WHERE b.goal IS DISTINCT FROM a.goal) THEN RAISE EXCEPTION 'Legacy goal backfill changed a monthly total'; END IF; END $$;
COMMENT ON COLUMN public.sales_cache.projected_sales IS 'DEPRECATED: goals resolved only from override_projection, living_projection, initial_projection.';
COMMENT ON TABLE public.schedule_projected_sales IS 'DEPRECATED: daily goals read from sales_cache via resolve_goal; no new writes.';
CREATE OR REPLACE FUNCTION public._resolve_goal(_location_id uuid, _date date) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT coalesce((SELECT coalesce(nullif(sc.override_projection,0),sc.living_projection,sc.initial_projection,0) FROM public.sales_cache sc WHERE sc.location_id=_location_id AND sc.sale_date=_date LIMIT 1),0) $$;
DO $$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public._schedule_week_labor_check(uuid)'::regprocedure) INTO d; d := replace(d,'coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales)','coalesce(nullif(c.override_projection,0), c.living_projection, c.initial_projection, 0)'); d := replace(d,'coalesce(sps.projected_sales, p.proj)','coalesce(p.proj,0)'); d := replace(d,'LEFT JOIN schedule_projected_sales sps ON sps.schedule_id = _schedule_id AND sps.day_of_week = d.idx',''); EXECUTE d; END $$;