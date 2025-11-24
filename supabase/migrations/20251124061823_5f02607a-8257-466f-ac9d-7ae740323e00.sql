-- Allow admins to delete chats
CREATE POLICY "Admins can delete chats"
ON chats FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- Add chat type for announcements
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_announcement boolean NOT NULL DEFAULT false;

-- Create read receipts table
CREATE TABLE IF NOT EXISTS message_read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

ALTER TABLE message_read_receipts ENABLE ROW LEVEL SECURITY;

-- Users can view read receipts in their chats
CREATE POLICY "Users can view read receipts in their chats"
ON message_read_receipts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN chat_members cm ON cm.chat_id = m.chat_id
    WHERE m.id = message_read_receipts.message_id
    AND cm.user_id = auth.uid()
  )
);

-- Users can mark messages as read
CREATE POLICY "Users can mark messages as read"
ON message_read_receipts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Create announcement reads table (tracks who opened announcement)
CREATE TABLE IF NOT EXISTS announcement_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chat_id, user_id)
);

ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

-- Users can view announcement reads for their chats
CREATE POLICY "Users can view announcement reads"
ON announcement_reads FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chat_members cm
    WHERE cm.chat_id = announcement_reads.chat_id
    AND cm.user_id = auth.uid()
  )
);

-- Users can mark announcements as opened
CREATE POLICY "Users can mark announcements as opened"
ON announcement_reads FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Admins can view all announcement reads
CREATE POLICY "Admins can view all announcement reads"
ON announcement_reads FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message_id ON message_read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_chat_id ON announcement_reads(chat_id);