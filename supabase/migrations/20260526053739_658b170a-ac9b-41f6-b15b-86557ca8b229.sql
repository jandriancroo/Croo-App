-- Theo unread read-state tracking
CREATE TABLE IF NOT EXISTS public.theo_read_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  last_read_message_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, location_id)
);

ALTER TABLE public.theo_read_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own theo read state"
  ON public.theo_read_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own theo read state"
  ON public.theo_read_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own theo read state"
  ON public.theo_read_state FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_theo_read_state_user_location
  ON public.theo_read_state (user_id, location_id);

-- Get unread count + latest preview for current user
CREATE OR REPLACE FUNCTION public.get_theo_unread(p_location_id uuid)
RETURNS TABLE (
  unread_count bigint,
  latest_preview text,
  latest_message_id uuid,
  latest_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_last_read timestamptz;
BEGIN
  IF v_user IS NULL OR p_location_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT COALESCE(rs.last_read_at, 'epoch'::timestamptz)
    INTO v_last_read
  FROM public.theo_read_state rs
  WHERE rs.user_id = v_user AND rs.location_id = p_location_id;

  IF v_last_read IS NULL THEN v_last_read := 'epoch'::timestamptz; END IF;

  RETURN QUERY
  WITH unread AS (
    SELECT m.id, m.content, m.created_at
    FROM public.theo_chat_messages m
    WHERE m.user_id = v_user
      AND m.location_id = p_location_id
      AND m.role = 'assistant'
      AND m.created_at > v_last_read
    ORDER BY m.created_at DESC
  )
  SELECT
    (SELECT COUNT(*) FROM unread)::bigint,
    (SELECT LEFT(REGEXP_REPLACE(content, E'[\\n\\r]+', ' ', 'g'), 90) FROM unread LIMIT 1),
    (SELECT id FROM unread LIMIT 1),
    (SELECT created_at FROM unread LIMIT 1);
END;
$$;

-- Mark messages read up to a given message id (only advances forward)
CREATE OR REPLACE FUNCTION public.mark_theo_read(p_location_id uuid, p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_msg_time timestamptz;
BEGIN
  IF v_user IS NULL OR p_location_id IS NULL OR p_message_id IS NULL THEN RETURN; END IF;

  SELECT created_at INTO v_msg_time
  FROM public.theo_chat_messages
  WHERE id = p_message_id AND user_id = v_user AND location_id = p_location_id;

  IF v_msg_time IS NULL THEN RETURN; END IF;

  INSERT INTO public.theo_read_state (user_id, location_id, last_read_at, last_read_message_id, updated_at)
  VALUES (v_user, p_location_id, v_msg_time, p_message_id, now())
  ON CONFLICT (user_id, location_id) DO UPDATE
    SET last_read_at = GREATEST(public.theo_read_state.last_read_at, EXCLUDED.last_read_at),
        last_read_message_id = CASE
          WHEN EXCLUDED.last_read_at >= public.theo_read_state.last_read_at
            THEN EXCLUDED.last_read_message_id
          ELSE public.theo_read_state.last_read_message_id
        END,
        updated_at = now();
END;
$$;

-- Realtime stream for theo chat messages so unread counts update live
ALTER PUBLICATION supabase_realtime ADD TABLE public.theo_chat_messages;