CREATE TABLE public.pkga_backup_functions (name text PRIMARY KEY, identity_args text, definition text NOT NULL, grants text, saved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pkga_backup_policies (tablename text, polname text, cmd text, roles text, using_expr text, check_expr text, saved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pkga_backup_integrations (id uuid PRIMARY KEY, location_id uuid, integration_type text, pull_labor_key_exists boolean, pull_labor_value text, updated_at timestamptz, credentials_md5 text, credentials_without_pull_labor_md5 text, saved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.pkga_backup_rows (table_name text, row_id uuid, location_id uuid, row_data jsonb NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());

REVOKE ALL ON public.pkga_backup_functions, public.pkga_backup_policies, public.pkga_backup_integrations, public.pkga_backup_rows FROM anon, authenticated, public;
GRANT ALL ON public.pkga_backup_functions, public.pkga_backup_policies, public.pkga_backup_integrations, public.pkga_backup_rows TO service_role;
ALTER TABLE public.pkga_backup_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkga_backup_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkga_backup_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pkga_backup_rows ENABLE ROW LEVEL SECURITY;

INSERT INTO public.pkga_backup_functions(name, identity_args, definition, grants)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid), array_to_string(p.proacl::text[], ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN (
   'labor_source_for','_store_labor','get_store_labor','labor_day_totals','labor_day_user_totals','_labor_pair_shifts',
   '_labor_totals_for_date','get_live_labor_totals','get_labor_totals_for_dates','get_cut_savings_total',
   '_pay_period_open_issues','pay_period_open_issues','pay_period_close_guard','labor_shifts',
   'send_hourly_sales_pulse','send_day_part_pulse');

INSERT INTO public.pkga_backup_policies(tablename, polname, cmd, roles, using_expr, check_expr)
SELECT 'labor_rules', polname, polcmd::text, polroles::regrole[]::text, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  FROM pg_policy WHERE polrelid = 'public.labor_rules'::regclass;

INSERT INTO public.pkga_backup_integrations(id, location_id, integration_type, pull_labor_key_exists, pull_labor_value, updated_at, credentials_md5, credentials_without_pull_labor_md5)
SELECT id, location_id, integration_type, credentials ? 'pull_labor', credentials->>'pull_labor', updated_at,
       md5(credentials::text), md5((credentials - 'pull_labor')::text)
  FROM public.location_integrations
 WHERE id IN ('004abcba-ddee-47ee-b441-3b0ecb2bd04f','df005fd5-5797-4e32-944a-0bdeb0d20d8e');

INSERT INTO public.pkga_backup_rows(table_name, row_id, location_id, row_data)
SELECT 'labor_rules', lr.id, lr.location_id, to_jsonb(lr) FROM public.labor_rules lr;
INSERT INTO public.pkga_backup_rows(table_name, row_id, location_id, row_data)
SELECT 'location_settings', ls.id, ls.location_id, jsonb_build_object('id', ls.id, 'location_id', ls.location_id, 'timezone', ls.timezone) FROM public.location_settings ls;