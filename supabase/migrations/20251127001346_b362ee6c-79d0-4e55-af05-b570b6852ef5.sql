-- Clean up duplicate Shift Marketplace chats and add unique constraint

-- Step 1: Find the oldest Shift Marketplace chat (we'll keep this one)
DO $$
DECLARE
  keep_chat_id UUID;
  duplicate_chat_id UUID;
BEGIN
  -- Get the oldest Shift Marketplace chat to keep
  SELECT id INTO keep_chat_id
  FROM public.chats
  WHERE title = '🔄 Shift Marketplace'
  ORDER BY created_at ASC
  LIMIT 1;

  -- Loop through and delete duplicate chats
  FOR duplicate_chat_id IN 
    SELECT id 
    FROM public.chats 
    WHERE title = '🔄 Shift Marketplace' 
    AND id != keep_chat_id
  LOOP
    -- Move messages from duplicate to kept chat
    UPDATE public.messages
    SET chat_id = keep_chat_id
    WHERE chat_id = duplicate_chat_id;

    -- Delete duplicate chat members (avoid duplicates)
    DELETE FROM public.chat_members
    WHERE chat_id = duplicate_chat_id
    AND user_id IN (
      SELECT user_id 
      FROM public.chat_members 
      WHERE chat_id = keep_chat_id
    );

    -- Move remaining chat members to kept chat
    UPDATE public.chat_members
    SET chat_id = keep_chat_id
    WHERE chat_id = duplicate_chat_id;

    -- Delete the duplicate chat
    DELETE FROM public.chats WHERE id = duplicate_chat_id;
  END LOOP;
END $$;

-- Step 2: Now add the unique constraint
CREATE UNIQUE INDEX unique_shift_marketplace_chat 
ON public.chats (title) 
WHERE title = '🔄 Shift Marketplace';