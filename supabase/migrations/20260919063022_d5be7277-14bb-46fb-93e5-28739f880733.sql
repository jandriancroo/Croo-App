ALTER TABLE public.announcement_posts ADD COLUMN IF NOT EXISTS subject text;

ALTER TABLE public.announcement_posts DROP CONSTRAINT IF EXISTS announcement_posts_subject_length;
ALTER TABLE public.announcement_posts ADD CONSTRAINT announcement_posts_subject_length CHECK (subject IS NULL OR char_length(subject) <= 120);