-- Add allowed_roles array column to shift_templates
-- This allows tagging shifts with multiple roles that can work them
ALTER TABLE public.shift_templates 
ADD COLUMN allowed_roles text[] DEFAULT ARRAY['team_member'];

-- Migrate existing role data to the new array column
UPDATE public.shift_templates 
SET allowed_roles = ARRAY[role::text]
WHERE role IS NOT NULL;

-- Add a comment explaining the column
COMMENT ON COLUMN public.shift_templates.allowed_roles IS 'Array of role names that can be assigned to this shift template';