CREATE TABLE public.theo_voice_prefs (
  user_id uuid PRIMARY KEY,
  voice text NOT NULL DEFAULT 'eve' CHECK (voice IN ('eve','ara','leo','rex','sal')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.theo_voice_prefs TO authenticated;
GRANT ALL ON public.theo_voice_prefs TO service_role;
ALTER TABLE public.theo_voice_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own voice pref read" ON public.theo_voice_prefs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own voice pref insert" ON public.theo_voice_prefs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own voice pref update" ON public.theo_voice_prefs FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());