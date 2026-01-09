-- Create efficient database function to count unread chats in a single call
CREATE OR REPLACE FUNCTION public.get_unread_chat_count(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::integer
  FROM public.chat_members cm
  JOIN public.chats c ON c.id = cm.chat_id
  WHERE cm.user_id = _user_id
    AND c.is_announcement = false
    AND EXISTS (
      SELECT 1 
      FROM public.messages m
      WHERE m.chat_id = cm.chat_id
        AND m.sender_id != _user_id
        AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)
      LIMIT 1
    )
$$;