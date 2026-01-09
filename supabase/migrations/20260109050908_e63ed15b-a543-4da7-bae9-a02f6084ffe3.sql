-- Add last_read_at column to chat_members for simpler unread tracking
ALTER TABLE public.chat_members 
ADD COLUMN last_read_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Update existing members to have read all current messages
UPDATE public.chat_members 
SET last_read_at = now();

-- Create index for faster unread queries
CREATE INDEX idx_chat_members_last_read ON public.chat_members(chat_id, user_id, last_read_at);