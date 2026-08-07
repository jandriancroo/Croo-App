ALTER TABLE public.checklist_assignments
  ADD COLUMN IF NOT EXISTS session_id uuid;

WITH groups AS (
  SELECT checklist_id, assigned_date, COALESCE(assigned_by, '00000000-0000-0000-0000-000000000000'::uuid) AS ab, gen_random_uuid() AS sid
  FROM public.checklist_assignments
  WHERE session_id IS NULL
  GROUP BY 1,2,3
)
UPDATE public.checklist_assignments a
SET session_id = g.sid
FROM groups g
WHERE a.session_id IS NULL
  AND a.checklist_id = g.checklist_id
  AND a.assigned_date = g.assigned_date
  AND COALESCE(a.assigned_by, '00000000-0000-0000-0000-000000000000'::uuid) = g.ab;

ALTER TABLE public.checklist_assignments
  ALTER COLUMN session_id SET DEFAULT gen_random_uuid();

ALTER TABLE public.checklist_assignments
  ALTER COLUMN session_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_assignments_session
  ON public.checklist_assignments (session_id);