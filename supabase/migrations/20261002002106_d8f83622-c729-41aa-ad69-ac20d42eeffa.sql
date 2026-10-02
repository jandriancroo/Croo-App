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
    WHERE m.role = 'user'
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
    coalesce(nullif(trim(p.full_name), ''), 'Unknown'),
    k.location_id, l.name,
    coalesce(c.n, 0), coalesce(v.n, 0), coalesce(v.secs, 0)::bigint, coalesce(v.q, 0)::bigint,
    greatest(c.last_at, v.last_at)
  FROM k
  LEFT JOIN chat c ON c.user_id = k.user_id AND c.location_id = k.location_id
  LEFT JOIN voice v ON v.user_id = k.user_id AND v.location_id = k.location_id
  LEFT JOIN profiles p ON p.id = k.user_id
  LEFT JOIN locations l ON l.id = k.location_id;
END $$;