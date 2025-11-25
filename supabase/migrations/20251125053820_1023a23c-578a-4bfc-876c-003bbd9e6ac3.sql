-- Update the template_type check constraint to allow 'dynamic'
ALTER TABLE public.checklists 
DROP CONSTRAINT IF EXISTS checklists_template_type_check;

ALTER TABLE public.checklists
ADD CONSTRAINT checklists_template_type_check 
CHECK (template_type IN ('standard', 'dynamic'));