
-- Internal worker: aggregate punch labor for one location + business date.
-- No auth gate here (gated by the public wrappers); never exposed directly.
create or replace function public._labor_totals_for_date(
  _location_id uuid,
  _date date,
  _show_live boolean
)
returns table(hours numeric, cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_business_today date;
  v_user record;
  v_punch record;
  v_day date;
  v_hour int;
  v_cutoff int;
  v_same_day_in timestamptz;
  v_prev_day date;
  v_clock_in timestamptz;
  v_break_start timestamptz;
  v_hours_sec numeric;
  v_break_sec numeric;
  v_net_hours numeric;
  v_wage numeric;
  v_total_hours numeric := 0;
  v_total_cost numeric := 0;
begin
  select coalesce(ls.timezone, 'America/Los_Angeles')
    into v_tz
    from location_settings ls
   where ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');

  -- Business date of "now" with the store-close cutoff rule (matches
  -- getBusinessDateInTimezone: before previous-day cutoff hour => yesterday).
  declare
    v_local_now timestamp := now() at time zone v_tz;
    v_today_cutoff int;
  begin
    select coalesce((extract(hour from lh.close_time::time)::int + 3) % 24, 5)
      into v_today_cutoff
      from location_hours lh
     where lh.location_id = _location_id
       and lh.day_of_week = extract(dow from (v_local_now::date - 1))::int;
    v_today_cutoff := coalesce(v_today_cutoff, 5);
    if extract(hour from v_local_now)::int <= v_today_cutoff then
      v_business_today := v_local_now::date - 1;
    else
      v_business_today := v_local_now::date;
    end if;
  end;

  -- Widen one day each side so overnight shifts bucket correctly.
  v_window_start := ((_date - 1)::timestamp at time zone v_tz);
  v_window_end   := ((_date + 2)::timestamp at time zone v_tz);

  for v_user in
    select distinct tp.user_id
      from time_punches tp
     where tp.location_id = _location_id
       and tp.punch_time >= v_window_start
       and tp.punch_time <= v_window_end
  loop
    v_clock_in := null;
    v_break_start := null;
    v_hours_sec := 0;
    v_break_sec := 0;

    for v_punch in
      select tp.punch_type, tp.punch_time
        from time_punches tp
       where tp.location_id = _location_id
         and tp.user_id = v_user.user_id
         and tp.punch_time >= v_window_start
         and tp.punch_time <= v_window_end
       order by tp.punch_time asc,
                case tp.punch_type
                  when 'clock_in' then 0
                  when 'break_start' then 1
                  when 'break_end' then 2
                  when 'clock_out' then 3
                  else 9 end asc,
                tp.id asc
    loop
      -- Day bucketing with overnight rollback (mirrors bucketUserPunchesByDay).
      v_day := (v_punch.punch_time at time zone v_tz)::date;
      v_hour := extract(hour from (v_punch.punch_time at time zone v_tz))::int;

      if v_punch.punch_type in ('clock_out', 'break_start', 'break_end') then
        select coalesce((extract(hour from lh.close_time::time)::int + 3) % 24, 5)
          into v_cutoff
          from location_hours lh
         where lh.location_id = _location_id
           and lh.day_of_week = extract(dow from (v_day - 1))::int;
        v_cutoff := coalesce(v_cutoff, 5);

        if v_hour <= v_cutoff then
          select min(tp.punch_time)
            into v_same_day_in
            from time_punches tp
           where tp.location_id = _location_id
             and tp.user_id = v_user.user_id
             and tp.punch_type = 'clock_in'
             and tp.punch_time >= v_window_start
             and tp.punch_time <= v_window_end
             and (tp.punch_time at time zone v_tz)::date = v_day;

          if v_same_day_in is null or v_same_day_in > v_punch.punch_time then
            v_prev_day := v_day - 1;
            if exists (
              select 1 from time_punches tp
               where tp.location_id = _location_id
                 and tp.user_id = v_user.user_id
                 and tp.punch_type = 'clock_in'
                 and tp.punch_time >= v_window_start
                 and tp.punch_time <= v_window_end
                 and (tp.punch_time at time zone v_tz)::date = v_prev_day
            ) then
              v_day := v_prev_day;
            end if;
          end if;
        end if;
      end if;

      -- Only process punches bucketed to the requested business date.
      if v_day <> _date then
        continue;
      end if;

      case v_punch.punch_type
        when 'clock_in' then
          if v_break_start is not null then
            v_break_sec := v_break_sec + extract(epoch from (v_punch.punch_time - v_break_start));
            v_break_start := null;
          elsif v_clock_in is null then
            v_clock_in := v_punch.punch_time;
          end if;
        when 'clock_out' then
          if v_clock_in is not null then
            v_hours_sec := v_hours_sec + extract(epoch from (v_punch.punch_time - v_clock_in));
            v_clock_in := null;
          end if;
        when 'break_start' then
          v_break_start := v_punch.punch_time;
        when 'break_end' then
          if v_break_start is not null then
            v_break_sec := v_break_sec + extract(epoch from (v_punch.punch_time - v_break_start));
            v_break_start := null;
          end if;
        else
          null;
      end case;
    end loop;

    -- Live extension: open punch / open break count through "now".
    if _show_live and _date = v_business_today then
      if v_clock_in is not null then
        v_hours_sec := v_hours_sec + extract(epoch from (now() - v_clock_in));
      end if;
      if v_break_start is not null then
        v_break_sec := v_break_sec + extract(epoch from (now() - v_break_start));
      end if;
    end if;

    v_net_hours := greatest(0, (v_hours_sec - v_break_sec) / 3600.0);
    if v_net_hours <= 0 then
      continue;
    end if;

    select coalesce(
             (select wh.hourly_wage from wage_history wh
               where wh.user_id = v_user.user_id
                 and wh.effective_date <= _date
               order by wh.effective_date desc limit 1),
             (select p.hourly_wage from profiles p where p.id = v_user.user_id),
             15)
      into v_wage;

    v_total_hours := v_total_hours + v_net_hours;
    v_total_cost := v_total_cost + v_net_hours * v_wage;
  end loop;

  return query select round(v_total_hours, 4), round(v_total_cost, 2);
end;
$$;

revoke all on function public._labor_totals_for_date(uuid, date, boolean) from public, anon, authenticated;

-- Gate: shift_manager or higher with access to the location (super admin always).
create or replace function public._labor_totals_authorized(_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public.has_role_or_higher(auth.uid(), 'shift_manager')
     and (
       public.is_super_admin(auth.uid())
       or public.has_location_access(auth.uid(), _location_id)
     );
$$;

revoke all on function public._labor_totals_authorized(uuid) from public, anon, authenticated;

-- Public aggregate: today's live labor for a location. Totals only — never wages.
create or replace function public.get_live_labor_totals(_location_id uuid, _date date)
returns table(hours numeric, cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._labor_totals_authorized(_location_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query select * from public._labor_totals_for_date(_location_id, _date, true);
end;
$$;

-- Public aggregate: closed-day totals for week/month gap fills. Totals only.
create or replace function public.get_labor_totals_for_dates(_location_id uuid, _dates date[])
returns table(date date, hours numeric, cost numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d date;
begin
  if not public._labor_totals_authorized(_location_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  foreach d in array _dates loop
    return query
      select d, t.hours, t.cost
        from public._labor_totals_for_date(_location_id, d, false) t;
  end loop;
end;
$$;

-- Cut-savings estimate: dollar savings per cut, computed with real wages
-- server-side. Returns savings amounts only — never hourly rates.
create or replace function public.get_cut_savings_estimate(_location_id uuid, _cuts jsonb)
returns table(user_id uuid, minutes integer, savings numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cut record;
  v_wage numeric;
begin
  if not public._labor_totals_authorized(_location_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  for v_cut in
    select (c->>'user_id')::uuid as user_id,
           greatest(0, coalesce((c->>'minutes')::int, 0)) as minutes
      from jsonb_array_elements(_cuts) c
  loop
    select coalesce(
             (select wh.hourly_wage from wage_history wh
               where wh.user_id = v_cut.user_id
                 and wh.effective_date <= current_date
               order by wh.effective_date desc limit 1),
             (select p.hourly_wage from profiles p where p.id = v_cut.user_id),
             15)
      into v_wage;
    user_id := v_cut.user_id;
    minutes := v_cut.minutes;
    savings := round(v_cut.minutes * v_wage / 60.0, 2);
    return next;
  end loop;
end;
$$;
