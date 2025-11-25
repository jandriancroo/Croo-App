-- Add display_order column to profiles table for custom employee ordering
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Create index for faster ordering queries
CREATE INDEX IF NOT EXISTS idx_profiles_display_order ON public.profiles(display_order);