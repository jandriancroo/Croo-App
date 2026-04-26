-- Performance optimization: wrap auth function calls in (SELECT ...) so Postgres
-- evaluates them once per query (InitPlan) instead of once per row.
-- This dramatically reduces seq scans on tiny lookup tables like user_roles, 
-- user_locations, and locations. Same security semantics, just faster.

-- ============ user_roles ============
DROP POLICY IF EXISTS "Only admins can manage roles" ON public.user_roles;
CREATE POLICY "Only admins can manage roles" ON public.user_roles
FOR ALL
USING ((SELECT public.has_role(auth.uid(), 'admin'::app_role)))
WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::app_role)));

-- ============ user_locations ============
DROP POLICY IF EXISTS "Admins and super_admins can manage user location assignments" ON public.user_locations;
CREATE POLICY "Admins and super_admins can manage user location assignments" ON public.user_locations
FOR ALL
USING ((SELECT public.is_super_admin(auth.uid())) OR (SELECT public.has_role(auth.uid(), 'admin'::app_role)))
WITH CHECK ((SELECT public.is_super_admin(auth.uid())) OR (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all user location assignments" ON public.user_locations;
CREATE POLICY "Admins can view all user location assignments" ON public.user_locations
FOR SELECT
USING ((SELECT public.is_super_admin(auth.uid())) OR (SELECT public.has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "Managers can view user locations at their locations" ON public.user_locations;
CREATE POLICY "Managers can view user locations at their locations" ON public.user_locations
FOR SELECT
USING ((SELECT public.has_role(auth.uid(), 'manager'::app_role)) AND (SELECT public.has_location_access(auth.uid(), location_id)));

DROP POLICY IF EXISTS "Shift managers can view user locations at their locations" ON public.user_locations;
CREATE POLICY "Shift managers can view user locations at their locations" ON public.user_locations
FOR SELECT
USING ((SELECT public.has_role(auth.uid(), 'shift_manager'::app_role)) AND (SELECT public.has_location_access(auth.uid(), location_id)));

DROP POLICY IF EXISTS "Users can view their own location assignments" ON public.user_locations;
CREATE POLICY "Users can view their own location assignments" ON public.user_locations
FOR SELECT
USING ((SELECT auth.uid()) = user_id);

-- ============ locations ============
DROP POLICY IF EXISTS "Brand admins can view locations in their brand" ON public.locations;
CREATE POLICY "Brand admins can view locations in their brand" ON public.locations
FOR SELECT
USING ((organization_id IS NOT NULL) AND (SELECT public.has_brand_access(auth.uid(), organization_id)));

DROP POLICY IF EXISTS "Location admins can manage their locations" ON public.locations;
CREATE POLICY "Location admins can manage their locations" ON public.locations
FOR ALL
USING ((SELECT public.has_role(auth.uid(), 'admin'::app_role)) AND EXISTS (
  SELECT 1 FROM public.user_locations
  WHERE user_locations.location_id = locations.id 
    AND user_locations.user_id = (SELECT auth.uid())
))
WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::app_role)) AND EXISTS (
  SELECT 1 FROM public.user_locations
  WHERE user_locations.location_id = locations.id 
    AND user_locations.user_id = (SELECT auth.uid())
));

DROP POLICY IF EXISTS "Org admins can manage locations in their org" ON public.locations;
CREATE POLICY "Org admins can manage locations in their org" ON public.locations
FOR ALL
USING ((organization_id IS NOT NULL) AND (SELECT public.is_org_admin(auth.uid(), organization_id)))
WITH CHECK ((organization_id IS NOT NULL) AND (SELECT public.is_org_admin(auth.uid(), organization_id)));

DROP POLICY IF EXISTS "Super admins can manage all locations" ON public.locations;
CREATE POLICY "Super admins can manage all locations" ON public.locations
FOR ALL
USING ((SELECT public.is_super_admin(auth.uid())))
WITH CHECK ((SELECT public.is_super_admin(auth.uid())));

DROP POLICY IF EXISTS "Users can view their assigned locations" ON public.locations;
CREATE POLICY "Users can view their assigned locations" ON public.locations
FOR SELECT
USING ((SELECT public.is_super_admin(auth.uid())) OR EXISTS (
  SELECT 1 FROM public.user_locations
  WHERE user_locations.location_id = locations.id 
    AND user_locations.user_id = (SELECT auth.uid())
));

-- ============ checklist_responses ============
DROP POLICY IF EXISTS "Users can view responses at their locations" ON public.checklist_responses;
CREATE POLICY "Users can view responses at their locations" ON public.checklist_responses
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.checklist_submissions cs
  WHERE cs.id = checklist_responses.submission_id 
    AND (SELECT public.has_location_access(auth.uid(), cs.location_id))
));

DROP POLICY IF EXISTS "Users can create responses" ON public.checklist_responses;
CREATE POLICY "Users can create responses" ON public.checklist_responses
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.checklist_submissions cs
  WHERE cs.id = checklist_responses.submission_id 
    AND (SELECT public.has_location_access(auth.uid(), cs.location_id))
));

DROP POLICY IF EXISTS "Users can update responses at their locations" ON public.checklist_responses;
CREATE POLICY "Users can update responses at their locations" ON public.checklist_responses
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.checklist_submissions cs
  WHERE cs.id = checklist_responses.submission_id 
    AND (SELECT public.has_location_access(auth.uid(), cs.location_id))
));

DROP POLICY IF EXISTS "Users can delete responses at their locations" ON public.checklist_responses;
CREATE POLICY "Users can delete responses at their locations" ON public.checklist_responses
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.checklist_submissions cs
  WHERE cs.id = checklist_responses.submission_id 
    AND (SELECT public.has_location_access(auth.uid(), cs.location_id))
));

-- ============ logbook_entry_values ============
DROP POLICY IF EXISTS "Users can view entry values at their locations" ON public.logbook_entry_values;
CREATE POLICY "Users can view entry values at their locations" ON public.logbook_entry_values
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.logbook_entries le
  WHERE le.id = logbook_entry_values.entry_id 
    AND (SELECT public.has_location_access(auth.uid(), le.location_id))
));

DROP POLICY IF EXISTS "Users can create entry values at their locations" ON public.logbook_entry_values;
CREATE POLICY "Users can create entry values at their locations" ON public.logbook_entry_values
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.logbook_entries le
  WHERE le.id = logbook_entry_values.entry_id 
    AND (SELECT public.has_location_access(auth.uid(), le.location_id))
));

DROP POLICY IF EXISTS "Admins and entry creators can update values" ON public.logbook_entry_values;
CREATE POLICY "Admins and entry creators can update values" ON public.logbook_entry_values
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.logbook_entries e
  WHERE e.id = logbook_entry_values.entry_id 
    AND ((SELECT public.has_role(auth.uid(), 'admin'::app_role)) 
      OR (SELECT public.has_role(auth.uid(), 'manager'::app_role)) 
      OR e.created_by = (SELECT auth.uid()))
));

DROP POLICY IF EXISTS "Admins and creators can delete entry values" ON public.logbook_entry_values;
CREATE POLICY "Admins and creators can delete entry values" ON public.logbook_entry_values
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.logbook_entries e
  WHERE e.id = logbook_entry_values.entry_id 
    AND ((SELECT public.is_super_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'admin'::app_role)) 
      OR (SELECT public.has_role(auth.uid(), 'manager'::app_role)) 
      OR e.created_by = (SELECT auth.uid()))
));

-- ============ scheduled_shifts ============
DROP POLICY IF EXISTS "Admins and managers can manage scheduled shifts" ON public.scheduled_shifts;
CREATE POLICY "Admins and managers can manage scheduled shifts" ON public.scheduled_shifts
FOR ALL
USING ((SELECT public.has_role(auth.uid(), 'admin'::app_role)) OR (SELECT public.has_role(auth.uid(), 'manager'::app_role)));

DROP POLICY IF EXISTS "Users can view shifts at their locations" ON public.scheduled_shifts;
CREATE POLICY "Users can view shifts at their locations" ON public.scheduled_shifts
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.schedules s
  WHERE s.id = scheduled_shifts.schedule_id 
    AND (SELECT public.has_location_access(auth.uid(), s.location_id))
));

-- ============ chat_members (the worst offender — 3-table join per row) ============
DROP POLICY IF EXISTS "Users can leave or admins can remove members" ON public.chat_members;
CREATE POLICY "Users can leave or admins can remove members" ON public.chat_members
FOR DELETE
USING (
  ((SELECT auth.uid()) = user_id) 
  OR EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = chat_members.chat_id AND c.created_by = (SELECT auth.uid())
  )
  OR (
    (SELECT public.has_role(auth.uid(), 'admin'::app_role)) 
    OR (SELECT public.has_role(auth.uid(), 'org_admin'::app_role)) 
    OR (SELECT public.is_super_admin(auth.uid()))
  ) AND EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = chat_members.chat_id 
      AND (SELECT public.has_location_access(auth.uid(), c.location_id))
  )
);

DROP POLICY IF EXISTS "Users can update their own chat membership" ON public.chat_members;
CREATE POLICY "Users can update their own chat membership" ON public.chat_members
FOR UPDATE
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============ checklist_items / checklist_role_tags / checklists / checklist_submissions ============
DROP POLICY IF EXISTS "Only admins can manage checklist items" ON public.checklist_items;
CREATE POLICY "Only admins can manage checklist items" ON public.checklist_items
FOR ALL
USING ((SELECT public.has_role(auth.uid(), 'admin'::app_role)))
WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "Only admins can manage role tags" ON public.checklist_role_tags;
CREATE POLICY "Only admins can manage role tags" ON public.checklist_role_tags
FOR ALL
USING ((SELECT public.has_role(auth.uid(), 'admin'::app_role)))
WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage checklists at their locations" ON public.checklists;
CREATE POLICY "Admins can manage checklists at their locations" ON public.checklists
FOR ALL
USING ((SELECT public.is_super_admin(auth.uid())) OR ((SELECT public.has_role(auth.uid(), 'admin'::app_role)) AND (SELECT public.has_location_access(auth.uid(), location_id))))
WITH CHECK ((SELECT public.is_super_admin(auth.uid())) OR ((SELECT public.has_role(auth.uid(), 'admin'::app_role)) AND (SELECT public.has_location_access(auth.uid(), location_id))));

DROP POLICY IF EXISTS "Users can view checklists at their locations" ON public.checklists;
CREATE POLICY "Users can view checklists at their locations" ON public.checklists
FOR SELECT
USING (
  (SELECT public.has_location_access(auth.uid(), location_id)) 
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.checklist_role_tags
      WHERE checklist_role_tags.checklist_id = checklists.id
    )
    OR EXISTS (
      SELECT 1 FROM public.checklist_role_tags crt
      JOIN public.user_roles ur ON ur.role = crt.role
      WHERE crt.checklist_id = checklists.id AND ur.user_id = (SELECT auth.uid())
    )
    OR (SELECT public.is_super_admin(auth.uid()))
    OR (SELECT public.has_role(auth.uid(), 'admin'::app_role))
  )
);

DROP POLICY IF EXISTS "Users can view submissions at their locations" ON public.checklist_submissions;
CREATE POLICY "Users can view submissions at their locations" ON public.checklist_submissions
FOR SELECT
USING ((SELECT public.has_location_access(auth.uid(), location_id)));

DROP POLICY IF EXISTS "Users can update submissions at their locations" ON public.checklist_submissions;
CREATE POLICY "Users can update submissions at their locations" ON public.checklist_submissions
FOR UPDATE
USING ((SELECT public.has_location_access(auth.uid(), location_id)));

DROP POLICY IF EXISTS "Users can create submissions at their locations" ON public.checklist_submissions;
CREATE POLICY "Users can create submissions at their locations" ON public.checklist_submissions
FOR INSERT
WITH CHECK (((SELECT auth.uid()) = submitted_by) AND (SELECT public.has_location_access(auth.uid(), location_id)));

DROP POLICY IF EXISTS "Users can delete own submissions" ON public.checklist_submissions;
CREATE POLICY "Users can delete own submissions" ON public.checklist_submissions
FOR DELETE
USING ((SELECT auth.uid()) = submitted_by);