CREATE TABLE public.checklist_user_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (checklist_id, user_id)
);
CREATE INDEX idx_checklist_user_tags_user ON public.checklist_user_tags(user_id);
CREATE INDEX idx_checklist_user_tags_checklist ON public.checklist_user_tags(checklist_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_user_tags TO authenticated;
GRANT ALL ON public.checklist_user_tags TO service_role;

ALTER TABLE public.checklist_user_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view checklist user tags"
  ON public.checklist_user_tags
  FOR SELECT
  USING (true);

CREATE POLICY "Only admins can manage checklist user tags"
  ON public.checklist_user_tags
  FOR ALL
  USING ((SELECT public.has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::app_role)));