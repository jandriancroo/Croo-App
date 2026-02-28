
-- Add is_deleted_for_everyone column to messages table for admin unsend feature
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_deleted_for_everyone boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Create index for filtering deleted messages
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON public.messages (is_deleted_for_everyone) WHERE is_deleted_for_everyone = true;
