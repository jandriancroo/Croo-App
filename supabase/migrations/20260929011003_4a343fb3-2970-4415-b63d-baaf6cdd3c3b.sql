-- Toast roster: the full list of Toast employees for a location (names + job titles).
-- Wages stay in toast_employee_wages (admin-only); this table only feeds the pairing screens.
create table public.toast_employees (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  toast_user_id text not null,
  toast_name text not null,
  job_title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, toast_user_id)
);

grant select on public.toast_employees to authenticated;
grant all on public.toast_employees to service_role;
alter table public.toast_employees enable row level security;

create policy "Managers view Toast roster"
  on public.toast_employees
  for select
  to authenticated
  using (
    public.has_role_or_higher(auth.uid(), 'shift_manager'::text)
    and public.has_location_access(auth.uid(), location_id)
  );

create trigger trg_toast_employees_updated_at
  before update on public.toast_employees
  for each row execute function public.update_updated_at_column();