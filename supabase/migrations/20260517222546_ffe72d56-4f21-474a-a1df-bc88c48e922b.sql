
-- 1. Extend item_type CHECK constraint
ALTER TABLE public.checklist_items DROP CONSTRAINT IF EXISTS checklist_items_item_type_check;
ALTER TABLE public.checklist_items ADD CONSTRAINT checklist_items_item_type_check
  CHECK (item_type = ANY (ARRAY['text','multiple_choice','image','confirmation','PHOTO','CHECKBOX','temperature','number','section_header','prep_list']));

-- 2. Prep row config (one row per prep line under a prep_list checklist item)
CREATE TABLE public.checklist_prep_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_item_id UUID NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  unit TEXT,
  par NUMERIC,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prep_rows_item ON public.checklist_prep_rows(checklist_item_id);
CREATE INDEX idx_prep_rows_inventory ON public.checklist_prep_rows(inventory_item_id);

ALTER TABLE public.checklist_prep_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view prep rows"
  ON public.checklist_prep_rows FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage prep rows"
  ON public.checklist_prep_rows FOR ALL
  USING ((SELECT has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT has_role(auth.uid(), 'admin'::app_role)));

CREATE TRIGGER trg_prep_rows_updated_at BEFORE UPDATE ON public.checklist_prep_rows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Completion history (one row per prep line per submission)
CREATE TABLE public.checklist_prep_completions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.checklist_submissions(id) ON DELETE CASCADE,
  checklist_item_id UUID NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,
  prep_row_id UUID REFERENCES public.checklist_prep_rows(id) ON DELETE SET NULL,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  location_id UUID,
  item_name TEXT NOT NULL,
  unit TEXT,
  par_at_time NUMERIC,
  on_hand NUMERIC,
  prep_amount NUMERIC,
  completed_by UUID REFERENCES auth.users(id),
  business_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prep_completions_submission ON public.checklist_prep_completions(submission_id);
CREATE INDEX idx_prep_completions_inventory ON public.checklist_prep_completions(inventory_item_id);
CREATE INDEX idx_prep_completions_location_date ON public.checklist_prep_completions(location_id, business_date);

ALTER TABLE public.checklist_prep_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view prep completions at their locations"
  ON public.checklist_prep_completions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.checklist_submissions cs
    WHERE cs.id = checklist_prep_completions.submission_id
      AND (SELECT has_location_access(auth.uid(), cs.location_id))
  ));

CREATE POLICY "Users insert prep completions at their locations"
  ON public.checklist_prep_completions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.checklist_submissions cs
    WHERE cs.id = checklist_prep_completions.submission_id
      AND (SELECT has_location_access(auth.uid(), cs.location_id))
  ));

CREATE POLICY "Users update prep completions at their locations"
  ON public.checklist_prep_completions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.checklist_submissions cs
    WHERE cs.id = checklist_prep_completions.submission_id
      AND (SELECT has_location_access(auth.uid(), cs.location_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.checklist_submissions cs
    WHERE cs.id = checklist_prep_completions.submission_id
      AND (SELECT has_location_access(auth.uid(), cs.location_id))
  ));

CREATE POLICY "Users delete prep completions at their locations"
  ON public.checklist_prep_completions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.checklist_submissions cs
    WHERE cs.id = checklist_prep_completions.submission_id
      AND (SELECT has_location_access(auth.uid(), cs.location_id))
  ));

CREATE TRIGGER trg_prep_completions_updated_at BEFORE UPDATE ON public.checklist_prep_completions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
