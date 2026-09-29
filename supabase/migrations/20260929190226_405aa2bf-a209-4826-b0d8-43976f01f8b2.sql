CREATE TABLE public.toast_robot_status (
  location_id uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'unknown',
  message text,
  run_id text,
  heartbeat_at timestamptz,
  last_dispatch_at timestamptz,
  last_alert_at timestamptz,
  alert_stage int NOT NULL DEFAULT 0,
  full_logins_date date,
  full_logins_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.toast_robot_status TO authenticated;
GRANT ALL ON public.toast_robot_status TO service_role;
ALTER TABLE public.toast_robot_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read robot status" ON public.toast_robot_status
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));