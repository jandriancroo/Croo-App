-- Add multi-slide support to punch_clock_templates
ALTER TABLE public.punch_clock_templates 
ADD COLUMN IF NOT EXISTS background_urls jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS overlay_texts jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS text_shadow boolean DEFAULT false;

-- Migrate existing single image/text to arrays
UPDATE public.punch_clock_templates
SET 
  background_urls = CASE 
    WHEN background_url IS NOT NULL THEN jsonb_build_array(background_url)
    ELSE '[]'::jsonb
  END,
  overlay_texts = CASE 
    WHEN overlay_text IS NOT NULL THEN jsonb_build_array(overlay_text)
    ELSE '[]'::jsonb
  END
WHERE background_urls = '[]'::jsonb OR background_urls IS NULL;