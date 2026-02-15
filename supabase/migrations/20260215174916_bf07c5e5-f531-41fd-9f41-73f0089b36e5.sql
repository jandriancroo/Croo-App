
ALTER TABLE public.temporary_tasks ADD COLUMN IF NOT EXISTS shareable BOOLEAN NOT NULL DEFAULT false;
