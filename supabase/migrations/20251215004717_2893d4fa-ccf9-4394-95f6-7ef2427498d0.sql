-- Add text shadow option for custom punch clock themes
ALTER TABLE public.location_settings 
ADD COLUMN IF NOT EXISTS punch_clock_text_shadow boolean DEFAULT false;