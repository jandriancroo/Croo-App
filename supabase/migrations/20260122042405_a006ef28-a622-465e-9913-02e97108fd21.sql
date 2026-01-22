-- Add text_position column to punch_clock_templates
ALTER TABLE public.punch_clock_templates 
ADD COLUMN IF NOT EXISTS text_position text DEFAULT 'overlay';

-- Add comment for clarity
COMMENT ON COLUMN public.punch_clock_templates.text_position IS 'Position of overlay text: overlay (on image) or below (under image)';