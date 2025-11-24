-- Add position field to shift templates
ALTER TABLE public.shift_templates 
ADD COLUMN position TEXT;

-- Add days of week field (array of integers 0-6, where 0=Monday)
ALTER TABLE public.shift_templates 
ADD COLUMN days_of_week INTEGER[] DEFAULT '{0,1,2,3,4,5,6}';

-- Update existing templates to have all days by default
UPDATE public.shift_templates 
SET days_of_week = '{0,1,2,3,4,5,6}'
WHERE days_of_week IS NULL;