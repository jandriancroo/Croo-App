create table public.toast_shifts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  toast_shift_id text not null,
  shift_date date not null,
  employee_name text not null,
  toast_user_id text,
  restaurant_user_id text,
  external_employee_id text,
  status text not null default 'UNKNOWN',
  in_time timestamptz not null,
  out_time timestamptz,
  breaks jsonb not null default '[]'::jsonb,
  missed_breaks jsonb not null default '[]'::jsonb,
  job_title text,
  is_tipped boolean not null default false,
  tips numeric(10,2) not null default 0,
  payable_seconds integer not null default 0,
  overtime_seconds integer not null default 0,
  unpaid_break_seconds integer not null default 0,
  anomaly_count integer not null default 0,
  croo_user_id uuid,
  croo_scheduled_shift_id uuid,
  updated_at timestamptz not null default now(),
  unique (location_id, toast_shift_id)
);

create index idx_toast_shifts_location_date on public.toast_shifts (location_id, shift_date);

grant select on public.toast_shifts to authenticated;
grant all on public.toast_shifts to service_role;

alter table public.toast_shifts enable row level security;

create policy "Location members can view Toast shifts"
  on public.toast_shifts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_locations ul
      where ul.user_id = auth.uid()
        and ul.location_id = toast_shifts.location_id
    )
  );