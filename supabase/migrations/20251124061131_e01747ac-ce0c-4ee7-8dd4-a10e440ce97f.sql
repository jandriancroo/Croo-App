-- Add group image support
ALTER TABLE chats ADD COLUMN IF NOT EXISTS group_image_url text;

-- Create message reactions table
CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('thumbs_up', 'thumbs_down', 'smile', 'laugh', 'heart', 'fire')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, reaction)
);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Users can view reactions in their chats
CREATE POLICY "Users can view reactions in their chats"
ON message_reactions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id
    WHERE m.id = message_reactions.message_id
    AND cm.user_id = auth.uid()
  )
);

-- Users can add reactions
CREATE POLICY "Users can add reactions"
ON message_reactions FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id
    WHERE m.id = message_reactions.message_id
    AND cm.user_id = auth.uid()
  )
);

-- Users can remove their own reactions
CREATE POLICY "Users can remove own reactions"
ON message_reactions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Add parent message for threading
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id uuid REFERENCES messages(id) ON DELETE CASCADE;

-- Create index for reactions
CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_message_id);