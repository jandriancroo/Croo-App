-- Add is_pinned field to chat_members table to allow users to pin chats
ALTER TABLE public.chat_members ADD COLUMN is_pinned boolean NOT NULL DEFAULT false;

-- Add index for efficient pinned chats lookup
CREATE INDEX idx_chat_members_pinned ON public.chat_members(user_id, is_pinned) WHERE is_pinned = true;