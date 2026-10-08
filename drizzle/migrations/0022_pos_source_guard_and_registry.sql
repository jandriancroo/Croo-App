-- 0022 POS source guard + data point registry.
-- Verify: select proname, proacl from pg_proc where proname in ('location_pos_source','_sales_cache_pos_guard');
-- Rollback: DROP TRIGGER sales_cache_pos_guard ON public.sales_cache (functions/table may stay unused).

CREATE OR REPLACE FUNCTION public.location_pos_source(_location_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT li.integration_type FROM public.location_integrations li
  WHERE li.location_id = _location_id AND li.is_active = true
    AND li.integration_type IN ('qubeyond','toast','clover','aloha')
  ORDER BY array_position(ARRAY['qubeyond','toast','clover','aloha'], li.integration_type::text)
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.location_pos_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.location_pos_source(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._sales_cache_pos_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p text;
BEGIN
  p := public.location_pos_source(NEW.location_id);
  IF p IS NOT NULL AND NEW.pos_source IS DISTINCT FROM p THEN
    NEW.pos_source := p;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._sales_cache_pos_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sales_cache_pos_guard() TO service_role;

CREATE TRIGGER sales_cache_pos_guard BEFORE INSERT OR UPDATE OF pos_source ON public.sales_cache
FOR EACH ROW EXECUTE FUNCTION public._sales_cache_pos_guard();

DO $$ DECLARE n int; BEGIN
  UPDATE public.sales_cache SET pos_source = 'toast'
  WHERE location_id = '0d1477e5-791d-42f4-9245-ad8b2e75c41c' AND pos_source = 'qubeyond' AND coalesce(net_sales,0) = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Hayward relabeled rows: %', n;
END $$;

CREATE TABLE public.data_point_registry (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('sales','labor','goal','comparison','cash','meta')),
  unit text, description text, canonical_table text, canonical_column text,
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  refresh_cadence text,
  readers text[] NOT NULL DEFAULT '{}',
  sot_status text NOT NULL CHECK (sot_status IN ('single','duplicated','planned')),
  sot_ref text, notes text,
  updated_at timestamptz DEFAULT now()
);
REVOKE ALL ON public.data_point_registry FROM anon;
GRANT SELECT ON public.data_point_registry TO authenticated;
GRANT ALL ON public.data_point_registry TO service_role;
ALTER TABLE public.data_point_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read data point registry" ON public.data_point_registry
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.data_point_registry (key,label,category,unit,description,canonical_table,canonical_column,sources,refresh_cadence,readers,sot_status,sot_ref,notes) VALUES
('net_sales','Net sales','sales','usd','Daily net sales per store business day','sales_cache','net_sales',
 '{"qubeyond":{"writer":"sales-service","raw_table":null,"cadence":"cron every minute","notes":"fetch-qubeyond-sales is a second, client-triggered writer (duplicated)"},
   "toast":{"writer":"toast-sync","raw_table":"toast_sales_cache","cadence":"pushed by external Toast runner; toast-watchdog every 5 min"},
   "clover":{"writer":"clover-sync","raw_table":"clover_sales_cache","cadence":"every 2 min + 11:00 UTC yesterday resync"},
   "aloha":{"writer":"aloha-sync","raw_table":"aloha_sales_cache","cadence":"every 2 min + 11:00 UTC yesterday resync"}}'::jsonb,
 'live (per POS)', ARRAY['Dashboard SalesSummary','DataCube','dock CompactDashboard','punch Manager Dashboard overlay','Org dashboard','pulses','daily briefing'],'duplicated','SOT audit #1 / Pack 3 P3.3',
 'Yesterday resync cron is 0 11 * * * UTC = 4 AM PDT / 3 AM PST.'),
('hourly_sales','Hourly sales','sales','usd','Per-hour sales for the business day','sales_cache','hourly_data',
 '{"qubeyond":{"writer":"sales-service","cadence":"cron every minute","notes":"also fetch-qubeyond-sales (client-triggered)"},"toast":{"writer":"toast-sync","raw_table":"toast_sales_cache"},"clover":{"writer":"clover-sync","raw_table":"clover_sales_cache"},"aloha":{"writer":"aloha-sync","raw_table":"aloha_sales_cache"}}'::jsonb,
 'live (per POS)', ARRAY['Dashboard SalesSummary','DataCube','pulses'],'duplicated','SOT audit #1 / Pack 3 P3.3',NULL),
('guest_count','Guest count','sales','guests','Daily guest/check count','sales_cache','guest_count',
 '{"qubeyond":{"writer":"sales-service","notes":"also fetch-qubeyond-sales (client-triggered)"},"toast":{"writer":"toast-sync","raw_table":"toast_sales_cache"},"clover":{"writer":"clover-sync","raw_table":"clover_sales_cache"},"aloha":{"writer":"aloha-sync","raw_table":"aloha_sales_cache"}}'::jsonb,
 'live (per POS)', ARRAY['Dashboard SalesSummary','DataCube','Org dashboard'],'duplicated','SOT audit #1 / Pack 3 P3.3',NULL),
('sales_projection','Sales projection','sales','usd','Daily forecast; resolution override > living > initial > projected','sales_cache','override_projection,living_projection,initial_projection,projected_sales',
 '{"qubeyond":{"writer":"sales-week-projections (_shared/weekProjections.ts)"},"toast":{"writer":"sales-week-projections (_shared/weekProjections.ts)"},"clover":{"writer":"sales-week-projections (_shared/weekProjections.ts)"},"aloha":{"writer":"sales-week-projections (_shared/weekProjections.ts)"}}'::jsonb,
 'cron 20 11 * * * and 25 11 * * * UTC (4:20 / 4:25 AM PDT)', ARRAY['Dashboard SalesSummary','DataCube','Schedule labor totals','Org dashboard'],'duplicated','SOT #5',
 'POS sync functions and fetch-qubeyond-sales also seed projections for synced days.'),
('sales_pace','Sales pace','sales','usd','Pace-adjusted projection for today','sales_cache','pace_adjusted_projection',
 '{"qubeyond":{"writer":"_shared/projections.ts computeAndSavePace"},"toast":{"writer":"_shared/projections.ts computeAndSavePace"},"clover":{"writer":"_shared/projections.ts computeAndSavePace"},"aloha":{"writer":"_shared/projections.ts computeAndSavePace"}}'::jsonb,
 'with each POS sync', ARRAY['Dashboard SalesSummary','DataCube','pulses'],'duplicated','SOT #5b',NULL),
('labor_cost_actual','Labor cost (actual)','labor','usd','Actual labor dollars per day','labor_cache','labor_cost',
 '{"qubeyond":{"writer":"labor-service","raw_table":"labor_cache (source qubeyond)"},"toast":{"writer":"labor-service","raw_table":"labor_cache (source toast)"},"aloha":{"writer":"labor-service","raw_table":"labor_cache (source aloha)"},"none":{"writer":"punch clock","raw_table":"labor_cache (source punch_clock)"}}'::jsonb,
 'nightly labor-service 1 11 * * * UTC (4:01 AM PDT); live via get_store_labor', ARRAY['Dashboard','DataCube','Schedule','Theo (get_store_labor)'],'duplicated','SOT #2/#3',
 'Live numbers only via get_store_labor / labor_source_for.'),
('labor_hours','Labor hours','labor','hours','Actual paid labor hours per day','labor_cache','labor_hours',
 '{"qubeyond":{"writer":"labor-service"},"toast":{"writer":"labor-service"},"aloha":{"writer":"labor-service"},"none":{"writer":"punch clock (punch_clock source)"}}'::jsonb,
 'nightly labor-service 4:01 AM PDT; live via get_store_labor', ARRAY['Dashboard','Schedule','Theo (get_store_labor)'],'duplicated','SOT #2/#3',NULL),
('labor_goal_pct','Labor goal %','goal','percent','Store weekly and per-day labor goal','week_templates','weekly_labor_percentage_target',
 '{"none":{"writer":"set_labor_goal / set_store_goal_template","raw_table":"week_templates (is_store_goal) + week_template_day_settings","notes":"fallback location_settings.labor_percentage_target"}}'::jsonb,
 'on edit', ARRAY['labor_goals','labor_goal_pct','labor_goal_display','Schedule Week Insights','punch overlay','dock CompactDashboard'],'single',NULL,NULL),
('last_year_sales','Last year sales','comparison','usd','Same weekday last year (sale_date - 364 days)','sales_cache','yoy_net_sales',
 '{"qubeyond":{"writer":"sales-service","notes":"-364 days"},"toast":{"writer":"toast-sync","notes":"-364 days"},"clover":{"writer":"clover-sync","notes":"-364 days"},"aloha":{"writer":"aloha-sync","notes":"-364 days"}}'::jsonb,
 'with each POS sync', ARRAY['Dashboard SalesSummary','DataCube','pulses'],'duplicated','SOT #10 / P3.4',
 'Verified 2026-10-08: sales-service already uses -364 (not same calendar date); still four writers.'),
('tips','Tips','cash','usd','Daily credit card and cash tips','daily_tips',NULL,
 '{"qubeyond":{"writer":"sales-service (tips sync) + fetch-qubeyond-sales (client-triggered)"},"clover":{"writer":"clover-sync"},"toast":"none","aloha":"none"}'::jsonb,
 'with POS sync', ARRAY['Tips / payroll views','Theo'],'duplicated',NULL,'Toast and Aloha do not write tips yet.'),
('pos_source','POS source','meta',NULL,'Which sales system a store runs on','location_integrations','integration_type',
 '{"none":{"writer":"location_integrations active row -> location_pos_source()","notes":"sales_cache.pos_source enforced by sales_cache_pos_guard"}}'::jsonb,
 'on integration change', ARRAY['sales_cache_pos_guard','_shared/posSources.ts','src/lib/pos/liveSales.ts'],'single',NULL,NULL);