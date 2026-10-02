-- Temporary side-by-side model test: production keeps its current model; a copy of the same
-- request goes to the candidate model and both answers are saved here for review.
create table public.ai_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  primary_model text not null,
  shadow_model text not null,
  primary_output text,
  shadow_output text,
  shadow_error text,
  primary_ms integer,
  shadow_ms integer,
  primary_in integer, primary_out integer,
  shadow_in integer, shadow_out integer,
  created_at timestamptz not null default now()
);
grant select on public.ai_shadow_runs to authenticated;
grant all on public.ai_shadow_runs to service_role;
alter table public.ai_shadow_runs enable row level security;
create policy "Super admins read shadow runs" on public.ai_shadow_runs
  for select to authenticated using (public.is_super_admin(auth.uid()));
create index ai_shadow_runs_job_idx on public.ai_shadow_runs (job, created_at desc);