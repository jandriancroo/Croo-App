ALTER TABLE public.checklist_prep_rows ADD COLUMN IF NOT EXISTS pan_key TEXT;
ALTER TABLE public.checklist_prep_completions ADD COLUMN IF NOT EXISTS pan_key TEXT;