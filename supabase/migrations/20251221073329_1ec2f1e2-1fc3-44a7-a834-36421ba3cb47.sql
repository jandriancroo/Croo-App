-- Add scheduled_at column to messages table for scheduled announcements
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;