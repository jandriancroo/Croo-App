
-- OPUS training modules synced from LMS
CREATE TABLE public.opus_training_modules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  opus_employee_name TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  module_name TEXT NOT NULL,
  completion_pct INTEGER NOT NULL DEFAULT 0,
  opus_module_id TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_id UUID REFERENCES public.temporary_tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, opus_module_id, user_id)
);

ALTER TABLE public.opus_training_modules ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read modules for locations they belong to
CREATE POLICY "Users can view OPUS modules for their locations"
  ON public.opus_training_modules FOR SELECT TO authenticated
  USING (location_id IN (SELECT public.get_user_location_ids(auth.uid())));

-- Service role handles all writes (edge function)
-- No INSERT/UPDATE/DELETE policies for anon/authenticated — only service_role bypasses RLS

CREATE TRIGGER update_opus_training_modules_updated_at
  BEFORE UPDATE ON public.opus_training_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
