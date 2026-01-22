-- Add last_read_at column to hiring_conversations for read tracking
ALTER TABLE public.hiring_conversations
ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP WITH TIME ZONE;