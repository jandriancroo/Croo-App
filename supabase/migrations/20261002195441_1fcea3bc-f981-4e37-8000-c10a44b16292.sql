CREATE TABLE public.theo_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  action text NOT NULL,
  proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','confirmed','cancelled','undone','failed')),
  record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.theo_action_log TO authenticated;
GRANT ALL ON public.theo_action_log TO service_role;
ALTER TABLE public.theo_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows insert" ON public.theo_action_log FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own rows update" ON public.theo_action_log FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own rows or super admin read" ON public.theo_action_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'super_admin'));
CREATE INDEX theo_action_log_user_idx ON public.theo_action_log (user_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.theo_action_log_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER theo_action_log_touch BEFORE UPDATE ON public.theo_action_log FOR EACH ROW EXECUTE FUNCTION public.theo_action_log_touch();