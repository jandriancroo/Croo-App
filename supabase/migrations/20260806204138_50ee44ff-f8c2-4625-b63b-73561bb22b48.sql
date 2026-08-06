ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS link_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS requires_manager_approval BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.checklist_submissions
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_signature TEXT;

CREATE INDEX IF NOT EXISTS idx_checklist_submissions_approved_by
  ON public.checklist_submissions(approved_by);