
-- Phase 3: Update RLS policies for location-scoped access

-- Helper function to check if user has access to a location
CREATE OR REPLACE FUNCTION public.has_location_access(_user_id uuid, _location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    is_super_admin(_user_id) OR
    EXISTS (
      SELECT 1 FROM public.user_locations
      WHERE user_id = _user_id AND location_id = _location_id
    )
$$;

-- ============ CHECKLISTS ============
DROP POLICY IF EXISTS "Users can view checklists for their role" ON public.checklists;
DROP POLICY IF EXISTS "Only admins can create checklists" ON public.checklists;
DROP POLICY IF EXISTS "Only admins can update checklists" ON public.checklists;
DROP POLICY IF EXISTS "Only admins can delete checklists" ON public.checklists;

CREATE POLICY "Users can view checklists at their locations"
ON public.checklists FOR SELECT
USING (
  is_active = true AND
  has_location_access(auth.uid(), location_id) AND
  (
    NOT EXISTS (SELECT 1 FROM checklist_role_tags WHERE checklist_id = checklists.id) OR
    EXISTS (
      SELECT 1 FROM checklist_role_tags crt
      JOIN user_roles ur ON ur.role = crt.role
      WHERE crt.checklist_id = checklists.id AND ur.user_id = auth.uid()
    )
  )
);

CREATE POLICY "Admins can manage checklists at their locations"
ON public.checklists FOR ALL
USING (
  is_super_admin(auth.uid()) OR
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
);

-- ============ CHECKLIST SUBMISSIONS ============
DROP POLICY IF EXISTS "Users can view all submissions" ON public.checklist_submissions;
DROP POLICY IF EXISTS "Users can create submissions" ON public.checklist_submissions;
DROP POLICY IF EXISTS "Users can update submissions" ON public.checklist_submissions;
DROP POLICY IF EXISTS "Users can delete own submissions" ON public.checklist_submissions;

CREATE POLICY "Users can view submissions at their locations"
ON public.checklist_submissions FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can create submissions at their locations"
ON public.checklist_submissions FOR INSERT
WITH CHECK (auth.uid() = submitted_by AND has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update submissions at their locations"
ON public.checklist_submissions FOR UPDATE
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can delete own submissions"
ON public.checklist_submissions FOR DELETE
USING (auth.uid() = submitted_by);

-- ============ CHATS ============
DROP POLICY IF EXISTS "Users can view their chats" ON public.chats;
DROP POLICY IF EXISTS "Authenticated users can create chats" ON public.chats;
DROP POLICY IF EXISTS "Chat creators can update" ON public.chats;
DROP POLICY IF EXISTS "Admins can delete chats" ON public.chats;

CREATE POLICY "Users can view chats at their locations"
ON public.chats FOR SELECT
USING (
  has_location_access(auth.uid(), location_id) AND
  (is_chat_member(auth.uid(), id) OR created_by = auth.uid())
);

CREATE POLICY "Users can create chats at their locations"
ON public.chats FOR INSERT
WITH CHECK (has_location_access(auth.uid(), location_id));

CREATE POLICY "Chat creators can update their chats"
ON public.chats FOR UPDATE
USING (auth.uid() = created_by);

CREATE POLICY "Admins can delete chats at their locations"
ON public.chats FOR DELETE
USING (
  is_super_admin(auth.uid()) OR
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
);

-- ============ SCHEDULES ============
DROP POLICY IF EXISTS "Users can view all schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins and managers can create schedules" ON public.schedules;
DROP POLICY IF EXISTS "Admins and managers can update schedules" ON public.schedules;

CREATE POLICY "Users can view schedules at their locations"
ON public.schedules FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins and managers can manage schedules at their locations"
ON public.schedules FOR ALL
USING (
  is_super_admin(auth.uid()) OR
  ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')) AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR
  ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')) AND has_location_access(auth.uid(), location_id))
);

-- ============ TIME PUNCHES ============
DROP POLICY IF EXISTS "Users can view own time punches" ON public.time_punches;
DROP POLICY IF EXISTS "Admins and managers can view all punches" ON public.time_punches;
DROP POLICY IF EXISTS "Users can insert own punches" ON public.time_punches;
DROP POLICY IF EXISTS "Admins and managers can manage punches" ON public.time_punches;

CREATE POLICY "Users can view punches at their locations"
ON public.time_punches FOR SELECT
USING (
  has_location_access(auth.uid(), location_id) AND
  (auth.uid() = user_id OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
);

CREATE POLICY "Users can insert punches at their locations"
ON public.time_punches FOR INSERT
WITH CHECK (auth.uid() = user_id AND has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins can manage punches at their locations"
ON public.time_punches FOR ALL
USING (
  is_super_admin(auth.uid()) OR
  ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')) AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR
  ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')) AND has_location_access(auth.uid(), location_id))
);

-- ============ LOGBOOK ENTRIES ============
DROP POLICY IF EXISTS "Everyone can view entries" ON public.logbook_entries;
DROP POLICY IF EXISTS "Authenticated users can create entries" ON public.logbook_entries;
DROP POLICY IF EXISTS "Admins and entry creators can update entries" ON public.logbook_entries;

CREATE POLICY "Users can view logbook entries at their locations"
ON public.logbook_entries FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can create logbook entries at their locations"
ON public.logbook_entries FOR INSERT
WITH CHECK (auth.uid() = created_by AND has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update logbook entries at their locations"
ON public.logbook_entries FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) AND
  (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager') OR auth.uid() = created_by)
);

-- ============ LOGBOOK CATEGORIES ============
DROP POLICY IF EXISTS "Everyone can view active categories" ON public.logbook_categories;
DROP POLICY IF EXISTS "Admins can manage categories" ON public.logbook_categories;

CREATE POLICY "Users can view categories at their locations"
ON public.logbook_categories FOR SELECT
USING (is_active = true AND has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins can manage categories at their locations"
ON public.logbook_categories FOR ALL
USING (
  is_super_admin(auth.uid()) OR
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
);

-- ============ AVAILABILITY REQUESTS ============
DROP POLICY IF EXISTS "Users can view own availability requests" ON public.availability_requests;
DROP POLICY IF EXISTS "Admins can view all availability requests" ON public.availability_requests;
DROP POLICY IF EXISTS "Users can create own availability requests" ON public.availability_requests;
DROP POLICY IF EXISTS "Users can update own pending requests" ON public.availability_requests;
DROP POLICY IF EXISTS "Admins can update all availability requests" ON public.availability_requests;

CREATE POLICY "Users can view availability requests at their locations"
ON public.availability_requests FOR SELECT
USING (
  has_location_access(auth.uid(), location_id) AND
  (auth.uid() = user_id OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'))
);

CREATE POLICY "Users can create availability requests at their locations"
ON public.availability_requests FOR INSERT
WITH CHECK (auth.uid() = user_id AND has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update own pending requests"
ON public.availability_requests FOR UPDATE
USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can update requests at their locations"
ON public.availability_requests FOR UPDATE
USING (
  is_super_admin(auth.uid()) OR
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
);

-- ============ SHIFT TEMPLATES ============
DROP POLICY IF EXISTS "Users can view shift templates" ON public.shift_templates;
DROP POLICY IF EXISTS "Admins can manage shift templates" ON public.shift_templates;

CREATE POLICY "Users can view shift templates at their locations"
ON public.shift_templates FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins can manage shift templates at their locations"
ON public.shift_templates FOR ALL
USING (
  is_super_admin(auth.uid()) OR
  ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')) AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR
  ((has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')) AND has_location_access(auth.uid(), location_id))
);
