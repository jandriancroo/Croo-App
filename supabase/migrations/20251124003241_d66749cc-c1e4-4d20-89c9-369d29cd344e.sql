-- Create checklist role tags table
CREATE TABLE public.checklist_role_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(checklist_id, role)
);

-- Enable RLS
ALTER TABLE public.checklist_role_tags ENABLE ROW LEVEL SECURITY;

-- Anyone can view role tags (needed to check permissions)
CREATE POLICY "Anyone can view checklist role tags"
ON public.checklist_role_tags
FOR SELECT
USING (true);

-- Only admins can manage role tags
CREATE POLICY "Only admins can manage role tags"
ON public.checklist_role_tags
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Update the checklists RLS policy to check role tags
DROP POLICY IF EXISTS "Anyone can view active checklists" ON public.checklists;

CREATE POLICY "Users can view checklists for their role"
ON public.checklists
FOR SELECT
USING (
  is_active = true AND (
    -- If no role tags exist, everyone can see it
    NOT EXISTS (
      SELECT 1 FROM public.checklist_role_tags
      WHERE checklist_id = checklists.id
    )
    OR
    -- If role tags exist, user must have one of the tagged roles
    EXISTS (
      SELECT 1 FROM public.checklist_role_tags crt
      JOIN public.user_roles ur ON ur.role = crt.role
      WHERE crt.checklist_id = checklists.id
        AND ur.user_id = auth.uid()
    )
  )
);