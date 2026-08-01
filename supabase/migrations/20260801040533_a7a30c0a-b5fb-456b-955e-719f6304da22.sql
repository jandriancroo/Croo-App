CREATE TABLE public.user_schedule_preferences (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  compact_view BOOLEAN,
  drag_drop_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_schedule_preferences TO authenticated;
GRANT ALL ON public.user_schedule_preferences TO service_role;

ALTER TABLE public.user_schedule_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own schedule preferences"
ON public.user_schedule_preferences FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_schedule_preferences_updated_at
BEFORE UPDATE ON public.user_schedule_preferences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();