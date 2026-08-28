ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS forked_from_item_id uuid NULL REFERENCES public.checklist_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_items_active
  ON public.checklist_items (checklist_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_items_forked_from
  ON public.checklist_items (forked_from_item_id)
  WHERE forked_from_item_id IS NOT NULL;