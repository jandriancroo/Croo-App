-- Rollback: system goals can be restored per location from sales_goal_cutover_backup_20261101 with croo.goal_backfill on; actuals and overrides are never replaced.
CREATE TABLE public.sales_goal_cutover_backup_20261101 (
 location_id uuid NOT NULL, sale_date date NOT NULL, initial_projection numeric, living_projection numeric, projected_sales numeric, override_projection numeric, override_at timestamptz, override_by uuid, backed_up_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(location_id,sale_date)
);
GRANT ALL ON public.sales_goal_cutover_backup_20261101 TO service_role;
REVOKE ALL ON public.sales_goal_cutover_backup_20261101 FROM PUBLIC,anon,authenticated;
ALTER TABLE public.sales_goal_cutover_backup_20261101 ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.replan_goal_cutover_20261101(_location_id uuid, _today date, _start date, _end date, _goals jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_claims text := nullif(current_setting('request.jwt.claims',true),'');
 v_tz text; v_pos text; v_local timestamp; v_start date; v_end date; v_window_end date;
 v_backup int; v_count int; v_before jsonb; v_after jsonb; v_outside jsonb; v_outside_after jsonb;
 v_prev text := coalesce(current_setting('croo.goal_backfill',true),''); v_error text;
BEGIN
 IF v_claims IS NOT NULL AND coalesce(v_claims::jsonb->>'role','') <> 'service_role' THEN RAISE EXCEPTION 'Service caller required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('goal-cutover-20261101:'||_location_id::text,0));
 IF EXISTS(SELECT 1 FROM goal_engine_runs WHERE location_id=_location_id AND source='cutover' AND error IS NULL) THEN RAISE EXCEPTION 'Cutover already completed'; END IF;
 SELECT coalesce(timezone,'America/Los_Angeles') INTO v_tz FROM location_settings WHERE location_id=_location_id;
 v_tz := coalesce(v_tz,'America/Los_Angeles');
 v_local := now() AT TIME ZONE v_tz;
 v_start := v_local::date + CASE WHEN extract(hour FROM v_local)<3 THEN 0 ELSE 1 END;
 v_end := date_trunc('week',v_start::timestamp)::date + 13;
 IF _today<>v_local::date OR _start<>v_start OR _end<>v_end THEN RAISE EXCEPTION 'Cutover window is stale or invalid'; END IF;
 SELECT integration_type INTO v_pos FROM location_integrations WHERE location_id=_location_id AND is_active AND integration_type IN ('qubeyond','toast','clover','aloha') ORDER BY array_position(ARRAY['qubeyond','toast','clover','aloha'],integration_type) LIMIT 1;
 IF v_pos IS NULL THEN RAISE EXCEPTION 'No active POS'; END IF;
 IF jsonb_typeof(_goals)<>'array' THEN RAISE EXCEPTION 'Goals must be an array'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(_goals) AS x(date date,goal numeric) WHERE date IS NULL OR goal IS NULL OR date<_start OR date>_end OR goal<0 OR goal<>round(goal)) OR (SELECT count(*) FROM jsonb_to_recordset(_goals) AS x(date date,goal numeric))<>_end-_start+1 OR (SELECT count(DISTINCT date) FROM jsonb_to_recordset(_goals) AS x(date date,goal numeric))<>_end-_start+1 THEN RAISE EXCEPTION 'Missing, duplicate or invalid daily goal'; END IF;
 -- Serialize cache writers only for this short atomic transaction. History math is prepared outside it.
 LOCK TABLE sales_cache IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(jsonb_agg(to_jsonb(c)-'initial_projection'-'living_projection'-'projected_sales' ORDER BY sale_date),'[]') INTO v_before FROM sales_cache c WHERE location_id=_location_id AND sale_date BETWEEN _start AND _end;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY sale_date),'[]') INTO v_outside FROM sales_cache c WHERE location_id=_location_id AND (sale_date<_start OR sale_date>_end);
 INSERT INTO sales_goal_cutover_backup_20261101(location_id,sale_date,initial_projection,living_projection,projected_sales,override_projection,override_at,override_by)
 SELECT location_id,sale_date,initial_projection,living_projection,projected_sales,override_projection,override_at,override_by FROM sales_cache WHERE location_id=_location_id AND sale_date BETWEEN _start AND _end;
 GET DIAGNOSTICS v_backup=ROW_COUNT;
 v_window_end := _today - extract(isodow FROM _today)::int;
 BEGIN
  PERFORM set_config('croo.goal_backfill','on',true);
  UPDATE sales_cache SET initial_projection=NULL,living_projection=NULL,projected_sales=NULL WHERE location_id=_location_id AND sale_date BETWEEN _start AND _end;
  INSERT INTO sales_cache(location_id,sale_date,pos_source,initial_projection,living_projection)
  SELECT _location_id,date,v_pos,goal,goal FROM jsonb_to_recordset(_goals) AS x(date date,goal numeric)
  ON CONFLICT(location_id,sale_date) DO UPDATE SET initial_projection=EXCLUDED.initial_projection,living_projection=EXCLUDED.living_projection;
  SELECT count(*) INTO v_count FROM sales_cache WHERE location_id=_location_id AND sale_date BETWEEN _start AND _end AND initial_projection IS NOT NULL AND living_projection IS NOT NULL AND initial_projection=living_projection;
  IF v_count<>_end-_start+1 THEN RAISE EXCEPTION 'Incomplete cutover'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c)-'initial_projection'-'living_projection'-'projected_sales' ORDER BY sale_date),'[]') INTO v_after FROM sales_cache c JOIN sales_goal_cutover_backup_20261101 b USING(location_id,sale_date) WHERE c.location_id=_location_id;
  IF v_before IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'Actuals, overrides or other fields changed'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY sale_date),'[]') INTO v_outside_after FROM sales_cache c WHERE location_id=_location_id AND (sale_date<_start OR sale_date>_end);
  IF v_outside IS DISTINCT FROM v_outside_after THEN RAISE EXCEPTION 'Days outside cutover changed'; END IF;
  PERFORM set_config('croo.goal_backfill',v_prev,true);
  INSERT INTO goal_engine_runs(location_id,local_run_date,source,wrote_planning,window_start,window_end,week_adj,days_written,error) VALUES(_location_id,_today,'cutover',true,v_window_end-27,v_window_end,1,v_count,NULL);
 EXCEPTION WHEN OTHERS THEN
  -- PostgreSQL rolls back the entire inner block, restoring original rows and removing any new rows; the backup above remains.
  v_error := SQLERRM;
  PERFORM set_config('croo.goal_backfill',v_prev,true);
  INSERT INTO goal_engine_runs(location_id,local_run_date,source,wrote_planning,window_start,window_end,week_adj,days_written,error) VALUES(_location_id,_today,'cutover',false,v_window_end-27,v_window_end,1,0,v_error);
  RETURN jsonb_build_object('location_id',_location_id,'success',false,'restored',true,'backup_rows',v_backup,'error',v_error);
 END;
 RETURN jsonb_build_object('location_id',_location_id,'success',true,'start',_start,'end',_end,'days',v_count,'backup_rows',v_backup,'actuals_overrides_unchanged',true,'outside_days_unchanged',true);
END $$;
REVOKE ALL ON FUNCTION public.replan_goal_cutover_20261101(uuid,date,date,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replan_goal_cutover_20261101(uuid,date,date,date,jsonb) TO service_role;