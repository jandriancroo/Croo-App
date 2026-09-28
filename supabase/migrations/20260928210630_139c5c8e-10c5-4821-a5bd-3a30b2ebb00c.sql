CREATE OR REPLACE FUNCTION public.get_live_labor_totals(_location_id uuid, _date date)
 RETURNS TABLE(hours numeric, cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tz text; v_bd date; v_d date; v_src text;
begin
  if not coalesce(
    public._labor_totals_authorized(_location_id)
    or coalesce(auth.uid() is not null and public.punch_device_location(auth.uid()) = _location_id, false),
    false
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_src := public.labor_source_for(_location_id);

  -- Toast labor: labor_cache rows are written by the toast-sync robot
  -- (source='toast', including today). Return the cache row for the date
  -- via the shared _store_labor helper — never the punch math.
  if v_src = 'toast' and _date is not null then
    return query
      select coalesce(s.hours, 0), coalesce(s.cost, 0)
        from public._store_labor(_location_id, _date, true) s;
    return;
  end if;

  if v_src is distinct from 'punch_clock' or _date is null then
    return query select * from public._legacy_get_live_labor_totals(_location_id, _date);
    return;
  end if;

  select ls.timezone into v_tz from public.location_settings ls where ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  v_bd := public.business_date(_location_id);
  v_d := _date;
  if _date = v_bd + 1 and _date = (now() at time zone v_tz)::date then
    v_d := v_bd;
  end if;

  if v_d < public.labor_new_rule_start() then
    return query select * from public._legacy_get_live_labor_totals(_location_id, _date);
    return;
  end if;

  return query
    select coalesce(s.hours, 0), coalesce(s.cost, 0)
      from public._store_labor(_location_id, v_d, true) s;
end;
$function$
