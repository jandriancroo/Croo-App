-- Business date for a location. MUST mirror the v_business_today block in
-- _labor_totals_for_date exactly. Keep in sync.
CREATE OR REPLACE FUNCTION public._location_business_date(_location_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_local_now timestamp;
  v_cutoff int;
begin
  select coalesce(ls.timezone, 'America/Los_Angeles')
    into v_tz
    from location_settings ls
   where ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');

  v_local_now := now() at time zone v_tz;

  select coalesce((extract(hour from lh.close_time::time)::int + 3) % 24, 5)
    into v_cutoff
    from location_hours lh
   where lh.location_id = _location_id
     and lh.day_of_week = extract(dow from (v_local_now::date - 1))::int;
  v_cutoff := coalesce(v_cutoff, 5);

  if extract(hour from v_local_now)::int <= v_cutoff then
    return v_local_now::date - 1;
  end if;
  return v_local_now::date;
end;
$function$;

REVOKE ALL ON FUNCTION public._location_business_date(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._location_business_date(uuid) FROM anon, authenticated;

-- EXACT cut savings, aggregate only. Validates the plan server-side, prices
-- each eligible cut at that person's wage as of the business date (same
-- lookup as _labor_totals_for_date), and returns ONE row of two scalars.
-- Never returns per-person rows. Ineligible users (not clocked in today at
-- this location) contribute 0.
CREATE OR REPLACE FUNCTION public.get_cut_savings_total(_location_id uuid, _cuts jsonb)
 RETURNS TABLE(total_minutes integer, est_savings numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e jsonb;
  v_n int;
  v_date date;
  v_tz text;
  v_minutes integer;
  v_savings numeric;
begin
  -- Authorization first (same gate as get_live_labor_totals).
  if not (
    coalesce(public._labor_totals_authorized(_location_id), false)
    or coalesce(auth.uid() is not null and public.punch_device_location(auth.uid()) = _location_id, false)
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _cuts is null or jsonb_typeof(_cuts) <> 'array' then
    raise exception 'invalid input: _cuts must be an array' using errcode = '22023';
  end if;

  v_n := jsonb_array_length(_cuts);
  if v_n < 1 or v_n > 50 then
    raise exception 'invalid input: 1..50 cuts' using errcode = '22023';
  end if;

  for v_e in select value from jsonb_array_elements(_cuts) loop
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e->'user_id') is distinct from 'string'
       or jsonb_typeof(v_e->'minutes') is distinct from 'number' then
      raise exception 'invalid input: each cut needs user_id and minutes' using errcode = '22023';
    end if;
    if (v_e->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid input: user_id' using errcode = '22023';
    end if;
    if (v_e->>'minutes') !~ '^[0-9]{1,4}$' then
      raise exception 'invalid input: minutes must be a whole number' using errcode = '22023';
    end if;
    if (v_e->>'minutes')::int > 720 then
      raise exception 'invalid input: minutes 0..720' using errcode = '22023';
    end if;
  end loop;

  if (select count(distinct lower(value->>'user_id')) from jsonb_array_elements(_cuts)) <> v_n then
    raise exception 'invalid input: duplicate user_id' using errcode = '22023';
  end if;

  -- Server-derived business date (never trust a client date).
  v_date := public._location_business_date(_location_id);

  select coalesce(ls.timezone, 'America/Los_Angeles')
    into v_tz
    from location_settings ls
   where ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');

  with c as (
    select (value->>'user_id')::uuid as user_id,
           (value->>'minutes')::int as minutes
      from jsonb_array_elements(_cuts)
  ), eligible as (
    select c.user_id, c.minutes
      from c
     where c.minutes > 0
       and exists (
         select 1 from time_punches tp
          where tp.location_id = _location_id
            and tp.user_id = c.user_id
            and tp.punch_type = 'clock_in'
            and tp.punch_time >= (v_date::timestamp at time zone v_tz)
            and tp.punch_time <= now()
       )
  )
  select coalesce(sum(e.minutes), 0)::int,
         coalesce(sum(e.minutes * coalesce(
           (select wh.hourly_wage from wage_history wh
             where wh.user_id = e.user_id and wh.effective_date <= v_date
             order by wh.effective_date desc limit 1),
           (select p.hourly_wage from profiles p where p.id = e.user_id),
           15) / 60.0), 0)
    into v_minutes, v_savings
    from eligible e;

  total_minutes := v_minutes;
  est_savings := round(v_savings, 2);
  return next; -- always exactly one row
end;
$function$;

REVOKE ALL ON FUNCTION public.get_cut_savings_total(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cut_savings_total(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cut_savings_total(uuid, jsonb) TO authenticated;

-- Close the live per-user, cross-location wage oracle (only caller removed in this ship).
REVOKE EXECUTE ON FUNCTION public.get_cut_savings_estimate(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cut_savings_estimate(uuid, jsonb) FROM anon, authenticated;
