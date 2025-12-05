-- Allow admins and entry creators to delete logbook entries
CREATE POLICY "Admins and creators can delete logbook entries"
ON public.logbook_entries
FOR DELETE
USING (
  has_location_access(auth.uid(), location_id) AND 
  (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR auth.uid() = created_by)
);

-- Allow admins and entry creators to delete logbook entry values
CREATE POLICY "Admins and creators can delete entry values"
ON public.logbook_entry_values
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM logbook_entries e
    WHERE e.id = logbook_entry_values.entry_id
    AND (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR e.created_by = auth.uid())
  )
);