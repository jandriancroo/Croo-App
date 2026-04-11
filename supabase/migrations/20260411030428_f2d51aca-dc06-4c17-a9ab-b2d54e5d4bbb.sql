
-- Create theo_chat_messages table
CREATE TABLE public.theo_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  chat_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Los_Angeles')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_theo_chat_messages_user_location_date 
  ON public.theo_chat_messages (user_id, location_id, chat_date);

-- Index for cleanup
CREATE INDEX idx_theo_chat_messages_chat_date 
  ON public.theo_chat_messages (chat_date);

-- Enable RLS
ALTER TABLE public.theo_chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own messages
CREATE POLICY "Users can read own theo messages"
  ON public.theo_chat_messages FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own messages
CREATE POLICY "Users can insert own theo messages"
  ON public.theo_chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own messages (for reset)
CREATE POLICY "Users can delete own theo messages"
  ON public.theo_chat_messages FOR DELETE
  USING (auth.uid() = user_id);

-- Cleanup function for nightly maintenance
CREATE OR REPLACE FUNCTION public.cleanup_theo_chat_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.theo_chat_messages
  WHERE chat_date < (now() AT TIME ZONE 'America/Los_Angeles')::date;
END;
$$;
