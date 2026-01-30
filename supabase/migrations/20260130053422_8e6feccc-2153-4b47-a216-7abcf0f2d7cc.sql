-- Create a function to get all unread counts in a single call
CREATE OR REPLACE FUNCTION public.get_chat_unread_counts(_user_id uuid, _location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  chats_count integer := 0;
  announcements_count integer := 0;
  marketplace_count integer := 0;
  hiring_count integer := 0;
  support_count integer := 0;
BEGIN
  -- Get chat/announcement/marketplace counts in one pass
  WITH member_chats AS (
    SELECT 
      cm.chat_id,
      cm.last_read_at,
      c.title,
      c.is_announcement,
      c.location_id
    FROM chat_members cm
    JOIN chats c ON c.id = cm.chat_id
    WHERE cm.user_id = _user_id
      AND c.location_id = _location_id
  ),
  latest_messages AS (
    SELECT DISTINCT ON (m.chat_id)
      m.chat_id,
      m.sender_id,
      m.created_at
    FROM messages m
    WHERE m.chat_id IN (SELECT chat_id FROM member_chats)
    ORDER BY m.chat_id, m.created_at DESC
  ),
  unread_chats AS (
    SELECT 
      mc.chat_id,
      mc.title,
      mc.is_announcement
    FROM member_chats mc
    JOIN latest_messages lm ON lm.chat_id = mc.chat_id
    WHERE lm.sender_id != _user_id
      AND (mc.last_read_at IS NULL OR lm.created_at > mc.last_read_at)
  )
  SELECT 
    COALESCE(SUM(CASE WHEN title = 'Shift Marketplace' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_announcement = true AND title != 'Shift Marketplace' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_announcement = false AND (title IS NULL OR title != 'Shift Marketplace') THEN 1 ELSE 0 END), 0)
  INTO marketplace_count, announcements_count, chats_count
  FROM unread_chats;

  -- Get hiring unread count
  WITH hiring_convs AS (
    SELECT 
      hc.id,
      hc.last_read_at
    FROM hiring_conversations hc
    JOIN job_applications ja ON ja.id = hc.application_id
    WHERE ja.location_id = _location_id
  ),
  latest_hiring_msgs AS (
    SELECT DISTINCT ON (hm.conversation_id)
      hm.conversation_id,
      hm.sender_type,
      hm.created_at
    FROM hiring_messages hm
    WHERE hm.conversation_id IN (SELECT id FROM hiring_convs)
    ORDER BY hm.conversation_id, hm.created_at DESC
  )
  SELECT COUNT(*)::integer INTO hiring_count
  FROM hiring_convs hc
  JOIN latest_hiring_msgs lhm ON lhm.conversation_id = hc.id
  WHERE lhm.sender_type = 'applicant'
    AND (hc.last_read_at IS NULL OR lhm.created_at > hc.last_read_at);

  -- Get support count (open/in_progress tickets)
  SELECT COUNT(*)::integer INTO support_count
  FROM support_tickets
  WHERE status IN ('open', 'in_progress');

  -- Build result
  result := jsonb_build_object(
    'chats', chats_count,
    'announcements', announcements_count,
    'marketplace', marketplace_count,
    'hiring', hiring_count,
    'support', support_count,
    'total', chats_count + announcements_count + marketplace_count + hiring_count + support_count
  );

  RETURN result;
END;
$$;