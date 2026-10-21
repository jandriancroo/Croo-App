CREATE TABLE public.checklist_bulk_read_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  location_id uuid,
  file_kind text NOT NULL,
  mime_type text,
  file_bytes integer,
  task_count integer NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.checklist_bulk_read_log TO authenticated;
GRANT ALL ON public.checklist_bulk_read_log TO service_role;
ALTER TABLE public.checklist_bulk_read_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read bulk read log" ON public.checklist_bulk_read_log
  FOR SELECT TO authenticated USING (public.has_role_or_higher(auth.uid(), 'super_admin'));
CREATE INDEX checklist_bulk_read_log_user_time ON public.checklist_bulk_read_log (user_id, created_at DESC);