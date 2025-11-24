-- Add notes column to wage_history for internal wage change notes
ALTER TABLE public.wage_history
ADD COLUMN notes text;

-- Create employee_notes table for timestamped employee comments
CREATE TABLE public.employee_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on employee_notes
ALTER TABLE public.employee_notes ENABLE ROW LEVEL SECURITY;

-- Only admins and managers can view employee notes
CREATE POLICY "Admins and managers can view employee notes"
ON public.employee_notes
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'manager'::app_role)
);

-- Only admins and managers can create employee notes
CREATE POLICY "Admins and managers can create employee notes"
ON public.employee_notes
FOR INSERT
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  AND auth.uid() = created_by
);

-- Only admins and managers can delete their own notes
CREATE POLICY "Admins and managers can delete own notes"
ON public.employee_notes
FOR DELETE
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  AND auth.uid() = created_by
);