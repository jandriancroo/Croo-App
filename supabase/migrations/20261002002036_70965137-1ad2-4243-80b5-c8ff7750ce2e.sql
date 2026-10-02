CREATE TABLE public.theo_voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  opener_key text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  seconds integer NOT NULL DEFAULT 0 CHECK (seconds >= 0 AND seconds <= 14400),
  questions integer NOT NULL DEFAULT 0 CHECK (questions >= 0 AND questions <= 1000)
);
CREATE INDEX idx_theo_voice_sessions_started ON public.theo_voice_sessions(started_at);
GRANT SELECT, INSERT, UPDATE ON public.theo_voice_sessions TO authenticated;
GRANT ALL ON public.theo_voice_sessions TO service_role;
ALTER TABLE public.theo_voice_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own voice sessions insert" ON public.theo_voice_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own voice sessions update" ON public.theo_voice_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own or super admin read" ON public.theo_voice_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.get_theo_usage(_start date, _end date)
RETURNS TABLE(user_id uuid, user_name text, location_id uuid, location_name text,
  chat_questions bigint, voice_sessions bigint, voice_seconds bigint, voice_questions bigint, last_used timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Super admins only';
  END IF;
  RETURN QUERY
  WITH chat AS (
    SELECT m.user_id, m.location_id, count(*) AS n, max(m.created_at) AS last_at
    FROM theo_chat_messages m
    WHERE m.role = 'user' AND m.created_at >= _start::timestamptz - interval '1 day' AND m.created_at < _end::timestamptz + interval '2 days'
      AND (m.created_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN _start AND _end
    GROUP BY 1, 2
  ), voice AS (
    SELECT v.user_id, v.location_id, count(*) AS n, sum(v.seconds) AS secs, sum(v.questions) AS q, max(v.started_at) AS last_at
    FROM theo_voice_sessions v
    WHERE (v.started_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN _start AND _end
    GROUP BY 1, 2
  ), k AS (
    SELECT c.user_id, c.location_id FROM chat c UNION SELECT v.user_id, v.location_id FROM voice v
  )
  SELECT k.user_id,
    coalesce(nullif(trim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''), 'Unknown'),
    k.location_id, l.name,
    coalesce(c.n, 0), coalesce(v.n, 0), coalesce(v.secs, 0)::bigint, coalesce(v.q, 0)::bigint,
    greatest(c.last_at, v.last_at)
  FROM k
  LEFT JOIN chat c ON c.user_id = k.user_id AND c.location_id = k.location_id
  LEFT JOIN voice v ON v.user_id = k.user_id AND v.location_id = k.location_id
  LEFT JOIN profiles p ON p.id = k.user_id
  LEFT JOIN locations l ON l.id = k.location_id;
END $$;
REVOKE ALL ON FUNCTION public.get_theo_usage(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_theo_usage(date, date) TO authenticated;