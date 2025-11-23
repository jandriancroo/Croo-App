-- Add reference fields to checklist_items
ALTER TABLE public.checklist_items
ADD COLUMN reference_image_url TEXT,
ADD COLUMN reference_link TEXT,
ADD COLUMN reference_video_url TEXT,
ADD COLUMN reference_notes TEXT;