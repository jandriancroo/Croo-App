CREATE TABLE public.theo_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  source text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_theo_ai_usage_created ON public.theo_ai_usage(created_at);
GRANT ALL ON public.theo_ai_usage TO service_role;
ALTER TABLE public.theo_ai_usage ENABLE ROW LEVEL SECURITY;
-- Written only by backend functions; read only through get_theo_usage.

DROP FUNCTION public.get_theo_usage(date, date);
CREATE FUNCTION public.get_theo_usage(_start date, _end date)
RETURNS TABLE(user_id uuid, user_name text, location_id uuid, location_name text,
  chat_questions bigint, voice_sessions bigint, voice_seconds bigint, voice_questions bigint,
  ai_calls bigint, prompt_tokens bigint, completion_tokens bigint, last_used timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Super admins only';
  END IF;
  RETURN QUERY
  WITH chat AS (
    SELECT m.user_id, m.location_id, count(*) AS n, max(m.created_at) AS last_at
    FROM theo_chat_messages m
    WHERE m.role = 'user' AND (m.created_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN _start AND _end
    GROUP BY 1, 2
  ), voice AS (
    SELECT v.user_id, v.location_id, count(*) AS n, sum(v.seconds) AS secs, sum(v.questions) AS q, max(v.started_at) AS last_at
    FROM theo_voice_sessions v
    WHERE (v.started_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN _start AND _end
    GROUP BY 1, 2
  ), ai AS (
    SELECT a.user_id, a.location_id, count(*) AS n, sum(a.prompt_tokens) AS pt, sum(a.completion_tokens) AS ct, max(a.created_at) AS last_at
    FROM theo_ai_usage a
    WHERE (a.created_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN _start AND _end
    GROUP BY 1, 2
  ), k AS (
    SELECT c.user_id, c.location_id FROM chat c
    UNION SELECT v.user_id, v.location_id FROM voice v
    UNION SELECT a.user_id, a.location_id FROM ai a
  )
  SELECT k.user_id,
    CASE WHEN k.user_id IS NULL THEN 'Theo (automatic updates)' ELSE coalesce(nullif(trim(p.full_name), ''), 'Unknown') END,
    k.location_id, l.name,
    coalesce(c.n, 0), coalesce(v.n, 0), coalesce(v.secs, 0)::bigint, coalesce(v.q, 0)::bigint,
    coalesce(a.n, 0), coalesce(a.pt, 0)::bigint, coalesce(a.ct, 0)::bigint,
    greatest(c.last_at, v.last_at, a.last_at)
  FROM k
  LEFT JOIN chat c ON c.user_id IS NOT DISTINCT FROM k.user_id AND c.location_id IS NOT DISTINCT FROM k.location_id
  LEFT JOIN voice v ON v.user_id IS NOT DISTINCT FROM k.user_id AND v.location_id IS NOT DISTINCT FROM k.location_id
  LEFT JOIN ai a ON a.user_id IS NOT DISTINCT FROM k.user_id AND a.location_id IS NOT DISTINCT FROM k.location_id
  LEFT JOIN profiles p ON p.id = k.user_id
  LEFT JOIN locations l ON l.id = k.location_id;
END $$;
REVOKE ALL ON FUNCTION public.get_theo_usage(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_theo_usage(date, date) TO authenticated;