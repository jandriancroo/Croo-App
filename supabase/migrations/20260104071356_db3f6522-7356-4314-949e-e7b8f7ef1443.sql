-- Add is_arcade flag to chats table to identify arcade chats
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS is_arcade boolean NOT NULL DEFAULT false;

-- Create an index for faster lookup of arcade chats
CREATE INDEX IF NOT EXISTS idx_chats_arcade_location ON public.chats(location_id, is_arcade) WHERE is_arcade = true;