DROP POLICY IF EXISTS "Users can view checklists at their locations" ON public.checklists;

CREATE POLICY "Users can view checklists at their locations"
ON public.checklists
FOR SELECT
USING (
  (SELECT public.has_location_access(auth.uid(), checklists.location_id))
  AND (
    (
      NOT EXISTS (SELECT 1 FROM public.checklist_role_tags crt WHERE crt.checklist_id = checklists.id)
      AND NOT EXISTS (SELECT 1 FROM public.checklist_user_tags cut WHERE cut.checklist_id = checklists.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.checklist_role_tags crt
      JOIN public.user_roles ur ON ur.role = crt.role
      WHERE crt.checklist_id = checklists.id AND ur.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.checklist_user_tags cut
      WHERE cut.checklist_id = checklists.id AND cut.user_id = (SELECT auth.uid())
    )
    OR (SELECT public.is_super_admin(auth.uid()))
    OR (SELECT public.has_role(auth.uid(), 'admin'::app_role))
  )
);