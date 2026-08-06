-- 1. Extend checklists
ALTER TABLE public.checklists DROP CONSTRAINT IF EXISTS checklists_template_type_check;
ALTER TABLE public.checklists ADD CONSTRAINT checklists_template_type_check
  CHECK (template_type = ANY (ARRAY['standard'::text, 'dynamic'::text, 'training'::text]));

ALTER TABLE public.checklists DROP CONSTRAINT IF EXISTS checklists_frequency_check;
ALTER TABLE public.checklists ADD CONSTRAINT checklists_frequency_check
  CHECK (frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'single_day'::text]));

ALTER TABLE public.checklists ADD COLUMN IF NOT EXISTS scheduled_date date;

-- 2. Extend checklist_items with manager_approval type
ALTER TABLE public.checklist_items DROP CONSTRAINT IF EXISTS checklist_items_item_type_check;
ALTER TABLE public.checklist_items ADD CONSTRAINT checklist_items_item_type_check
  CHECK (item_type = ANY (ARRAY['text'::text, 'multiple_choice'::text, 'image'::text, 'confirmation'::text, 'PHOTO'::text, 'CHECKBOX'::text, 'temperature'::text, 'number'::text, 'section_header'::text, 'prep_list'::text, 'manager_approval'::text]));

-- 3. Assignments table
CREATE TABLE IF NOT EXISTS public.checklist_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL,
  assigned_date date NOT NULL,
  assigned_by uuid,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  approver_user_ids uuid[] NOT NULL DEFAULT '{}',
  approver_roles app_role[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'assigned',
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  approval_signature text,
  manager_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_assignments_status_check CHECK (status = ANY (ARRAY['assigned','in_progress','pending_approval','changes_requested','approved','cancelled'])),
  CONSTRAINT checklist_assignments_unique UNIQUE (checklist_id, assignee_id, assigned_date)
);

CREATE INDEX IF NOT EXISTS idx_checklist_assignments_assignee_date ON public.checklist_assignments(assignee_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_checklist_assignments_location_date ON public.checklist_assignments(location_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_checklist_assignments_checklist ON public.checklist_assignments(checklist_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_assignments TO authenticated;
GRANT ALL ON public.checklist_assignments TO service_role;

ALTER TABLE public.checklist_assignments ENABLE ROW LEVEL SECURITY;

-- helper: is the current user an approver for this assignment row
CREATE OR REPLACE FUNCTION public.is_checklist_assignment_approver(_assignment public.checklist_assignments, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id = ANY(_assignment.approver_user_ids)
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.role = ANY(_assignment.approver_roles)
      );
$$;

CREATE POLICY "Assignees can view their own assignments"
ON public.checklist_assignments FOR SELECT TO authenticated
USING (assignee_id = auth.uid());

CREATE POLICY "Assignees can update their own assignments"
ON public.checklist_assignments FOR UPDATE TO authenticated
USING (assignee_id = auth.uid())
WITH CHECK (assignee_id = auth.uid());

CREATE POLICY "Location managers can view assignments"
ON public.checklist_assignments FOR SELECT TO authenticated
USING (
  location_id IN (SELECT public.get_user_location_ids(auth.uid()))
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Location managers can manage assignments"
ON public.checklist_assignments FOR ALL TO authenticated
USING (
  location_id IN (SELECT public.get_user_location_ids(auth.uid()))
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
)
WITH CHECK (
  location_id IN (SELECT public.get_user_location_ids(auth.uid()))
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Named approvers can view assignments"
ON public.checklist_assignments FOR SELECT TO authenticated
USING (public.is_checklist_assignment_approver(checklist_assignments, auth.uid()));

CREATE POLICY "Named approvers can approve assignments"
ON public.checklist_assignments FOR UPDATE TO authenticated
USING (public.is_checklist_assignment_approver(checklist_assignments, auth.uid()))
WITH CHECK (public.is_checklist_assignment_approver(checklist_assignments, auth.uid()));

CREATE TRIGGER update_checklist_assignments_updated_at
BEFORE UPDATE ON public.checklist_assignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Link responses / submissions to an assignment
ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.checklist_assignments(id) ON DELETE CASCADE;
ALTER TABLE public.checklist_submissions ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.checklist_assignments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_checklist_responses_assignment ON public.checklist_responses(assignment_id);
CREATE INDEX IF NOT EXISTS idx_checklist_submissions_assignment ON public.checklist_submissions(assignment_id);