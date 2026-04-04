DROP POLICY "Users can view checklists at their locations" ON public.checklists;

CREATE POLICY "Users can view checklists at their locations"
ON public.checklists
FOR SELECT
USING (
  has_location_access(auth.uid(), location_id)
  AND (
    NOT EXISTS (
      SELECT 1 FROM checklist_role_tags WHERE checklist_role_tags.checklist_id = checklists.id
    )
    OR EXISTS (
      SELECT 1 FROM checklist_role_tags crt
      JOIN user_roles ur ON ur.role = crt.role
      WHERE crt.checklist_id = checklists.id AND ur.user_id = auth.uid()
    )
    OR is_super_admin(auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);