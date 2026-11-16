-- Time Tracking approvals (Jordan, Nov 15 2026):
--   1) A shift with no clock-out (including a live, in-progress shift) can't be approved.
--   2) Changing a shift's punches (time, type, person, store) or adding/removing a punch
--      clears that shift's approval, so it has to be reviewed again.
-- Enforced on the server for every write path (app, API, functions), checked against the
-- state AFTER the whole statement. Shift pairing mirrors public._labor_pair_shifts.

-- Shifts for one person at one store around a time range, paired like _labor_pair_shifts.
-- seg_limit: clock-out time (closed), next clock-in (forgotten clock-out) or infinity (still open).
create or replace function public._punch_shift_segments(
  _user uuid, _location uuid, _from timestamptz, _to timestamptz
)
returns table(seg_start timestamptz, seg_limit timestamptz, is_open boolean, member_ids uuid[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_dup interval;
  v_rule_start date := public.labor_new_rule_start();
  v_new boolean := true;
  r record;
  v_ss timestamptz;
  v_sid uuid;
  v_bs timestamptz;
  v_ign_out_at timestamptz;
  v_ign_bend_at timestamptz;
  v_prev_id uuid;
  v_last_id uuid;
  v_members uuid[];
begin
  if _user is null or _location is null or _from is null or _to is null then
    return;
  end if;

  select make_interval(mins => coalesce(lr.duplicate_tap_minutes, 5))
    into v_dup
    from public.labor_rules lr
   where lr.location_id = _location
   order by lr.created_at
   limit 1;
  v_dup := coalesce(v_dup, interval '5 minutes');

  for r in
    select d.punch_type, d.punch_time, d.id
      from (
        select distinct on (tp.punch_time, tp.punch_type) tp.punch_type, tp.punch_time, tp.id
          from public.time_punches tp
         where tp.location_id = _location
           and tp.user_id = _user
           and tp.punch_time >= _from - interval '24 hours'
           and tp.punch_time <  _to + interval '24 hours'
           and tp.punch_type in ('clock_in', 'clock_out', 'break_start', 'break_end')
         order by tp.punch_time, tp.punch_type, tp.id
      ) d
     order by d.punch_time,
              case d.punch_type
                when 'break_end'   then 0
                when 'clock_out'   then 1
                when 'clock_in'    then 2
                when 'break_start' then 3
              end,
              d.id
  loop
    v_last_id := v_prev_id;
    v_prev_id := r.id;

    if r.punch_type = 'clock_in' then
      if v_ss is null then
        if v_ign_out_at is not distinct from r.punch_time then
          continue;
        end if;
        v_ss := r.punch_time; v_sid := r.id; v_bs := null; v_members := array[r.id];
        v_new := coalesce(public.business_date(_location, r.punch_time) >= v_rule_start, true);
      elsif not v_new then
        -- Pre-cutoff rule: a clock-in inside a shift does not split it.
        v_members := v_members || r.id;
      elsif v_bs is not null then
        -- Clock-in while on break ends the break.
        v_bs := null;
        v_members := v_members || r.id;
      elsif v_last_id is not distinct from v_sid and r.punch_time - v_ss <= v_dup then
        -- Double tap: shift counts from the first tap.
        v_members := v_members || r.id;
      else
        -- Forgotten clock-out: the earlier shift ends open (no clock-out).
        seg_start := v_ss; seg_limit := r.punch_time; is_open := true; member_ids := v_members;
        return next;
        v_ss := r.punch_time; v_sid := r.id; v_bs := null; v_members := array[r.id];
        v_new := coalesce(public.business_date(_location, r.punch_time) >= v_rule_start, true);
      end if;

    elsif r.punch_type = 'clock_out' then
      if v_ss is null then
        v_ign_out_at := r.punch_time;
        continue;
      end if;
      seg_start := v_ss; seg_limit := r.punch_time; is_open := false; member_ids := v_members || r.id;
      return next;
      v_ss := null; v_sid := null; v_bs := null; v_members := null;

    elsif r.punch_type = 'break_start' then
      if v_ss is not null then
        v_members := v_members || r.id;
        if v_bs is null and v_ign_bend_at is distinct from r.punch_time then
          v_bs := r.punch_time;
        end if;
      end if;

    elsif r.punch_type = 'break_end' then
      if v_ss is not null then
        v_members := v_members || r.id;
      end if;
      if v_bs is null then
        v_ign_bend_at := r.punch_time;
        continue;
      end if;
      v_bs := null;
    end if;
  end loop;

  if v_ss is not null then
    -- Still open at the end of the punches (live or missing clock-out).
    seg_start := v_ss; seg_limit := 'infinity'::timestamptz; is_open := true; member_ids := v_members;
    return next;
  end if;
end;
$$;

-- Core guard. _approved: punches newly approved in this statement. _touched: punch positions
-- whose shift changed (id set = new position; id null = old/deleted position, match by time).
create or replace function public._tp_approval_guard(_approved jsonb, _touched jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
begin
  -- 1) Block approving any punch whose shift has no clock-out, after this statement.
  if jsonb_typeof(_approved) = 'array' and jsonb_array_length(_approved) > 0 then
    for g in
      select (e->>'user_id')::uuid as u, (e->>'location_id')::uuid as l,
             min((e->>'punch_time')::timestamptz) as f, max((e->>'punch_time')::timestamptz) as t
        from jsonb_array_elements(_approved) e
       group by 1, 2
    loop
      if exists (
        select 1
          from public._punch_shift_segments(g.u, g.l, g.f, g.t) s
          join jsonb_array_elements(_approved) e
            on (e->>'user_id')::uuid = g.u and (e->>'location_id')::uuid = g.l
         where s.is_open
           and ((e->>'id')::uuid = any(s.member_ids)
                or ((e->>'punch_time')::timestamptz >= s.seg_start
                    and (e->>'punch_time')::timestamptz < s.seg_limit))
      ) then
        raise exception 'Cannot approve a shift that has no clock-out.'
          using errcode = 'P0001', hint = 'Add the clock-out first, then approve.';
      end if;
    end loop;
  end if;

  -- 2) Any change to a shift clears that whole shift's approval.
  if jsonb_typeof(_touched) = 'array' and jsonb_array_length(_touched) > 0 then
    for g in
      select (e->>'user_id')::uuid as u, (e->>'location_id')::uuid as l,
             min((e->>'punch_time')::timestamptz) as f, max((e->>'punch_time')::timestamptz) as t
        from jsonb_array_elements(_touched) e
       where e->>'user_id' is not null and e->>'location_id' is not null
       group by 1, 2
    loop
      update public.time_punches tp
         set approved_at = null, approved_by = null
        from (
          select s.*
            from public._punch_shift_segments(g.u, g.l, g.f, g.t) s
           where exists (
             select 1
               from jsonb_array_elements(_touched) e
              where (e->>'user_id')::uuid = g.u and (e->>'location_id')::uuid = g.l
                and ((e->>'id' is not null and (e->>'id')::uuid = any(s.member_ids))
                     or ((e->>'punch_time')::timestamptz >= s.seg_start
                         and ((e->>'punch_time')::timestamptz < s.seg_limit
                              or (not s.is_open and (e->>'punch_time')::timestamptz = s.seg_limit))))
           )
        ) s
       where tp.user_id = g.u
         and tp.location_id = g.l
         and tp.approved_at is not null
         and (tp.id = any(s.member_ids)
              or (tp.punch_time >= s.seg_start
                  and (tp.punch_time < s.seg_limit
                       or (not s.is_open and tp.punch_time = s.seg_limit))));
    end loop;
  end if;
end;
$$;

-- Row level: an edited punch can never keep its approval (even if the update re-sends approved_at).
create or replace function public.tp_edit_clears_own_approval()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (new.punch_time, new.punch_type, new.user_id, new.location_id)
     is distinct from (old.punch_time, old.punch_type, old.user_id, old.location_id) then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;

create or replace function public.tp_approval_guard_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._tp_approval_guard(
    (select jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'location_id', n.location_id, 'punch_time', n.punch_time))
       from tp_new n where n.approved_at is not null),
    (select jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'location_id', n.location_id, 'punch_time', n.punch_time))
       from tp_new n)
  );
  return null;
end;
$$;

create or replace function public.tp_approval_guard_after_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._tp_approval_guard(
    (select jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'location_id', n.location_id, 'punch_time', n.punch_time))
       from tp_new n join tp_old o on o.id = n.id
      where n.approved_at is not null and o.approved_at is null),
    (select jsonb_agg(x)
       from (
         select jsonb_build_object('id', n.id, 'user_id', n.user_id, 'location_id', n.location_id, 'punch_time', n.punch_time) as x
           from tp_new n join tp_old o on o.id = n.id
          where (n.punch_time, n.punch_type, n.user_id, n.location_id)
                is distinct from (o.punch_time, o.punch_type, o.user_id, o.location_id)
         union all
         select jsonb_build_object('id', null, 'user_id', o.user_id, 'location_id', o.location_id, 'punch_time', o.punch_time)
           from tp_new n join tp_old o on o.id = n.id
          where (n.punch_time, n.punch_type, n.user_id, n.location_id)
                is distinct from (o.punch_time, o.punch_type, o.user_id, o.location_id)
       ) t)
  );
  return null;
end;
$$;

create or replace function public.tp_approval_guard_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._tp_approval_guard(
    null,
    (select jsonb_agg(jsonb_build_object('id', null, 'user_id', o.user_id, 'location_id', o.location_id, 'punch_time', o.punch_time))
       from tp_old o)
  );
  return null;
end;
$$;

drop trigger if exists trg_tp_edit_clears_own_approval on public.time_punches;
create trigger trg_tp_edit_clears_own_approval
  before update on public.time_punches
  for each row execute function public.tp_edit_clears_own_approval();

drop trigger if exists trg_tp_approval_guard_ins on public.time_punches;
create trigger trg_tp_approval_guard_ins
  after insert on public.time_punches
  referencing new table as tp_new
  for each statement execute function public.tp_approval_guard_after_insert();

drop trigger if exists trg_tp_approval_guard_upd on public.time_punches;
create trigger trg_tp_approval_guard_upd
  after update on public.time_punches
  referencing old table as tp_old new table as tp_new
  for each statement execute function public.tp_approval_guard_after_update();

drop trigger if exists trg_tp_approval_guard_del on public.time_punches;
create trigger trg_tp_approval_guard_del
  after delete on public.time_punches
  referencing old table as tp_old
  for each statement execute function public.tp_approval_guard_after_delete();

-- Andy's guard: internal helpers and trigger functions are not callable by app roles.
revoke execute on function public._punch_shift_segments(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._tp_approval_guard(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.tp_edit_clears_own_approval() from public, anon, authenticated;
revoke execute on function public.tp_approval_guard_after_insert() from public, anon, authenticated;
revoke execute on function public.tp_approval_guard_after_update() from public, anon, authenticated;
revoke execute on function public.tp_approval_guard_after_delete() from public, anon, authenticated;
