-- Add due_by_time and template_type to checklists
ALTER TABLE checklists 
ADD COLUMN due_by_time time without time zone,
ADD COLUMN template_type text DEFAULT 'standard' CHECK (template_type IN ('standard', 'weekly'));

-- Add days_of_week to checklist_items for weekly templates
ALTER TABLE checklist_items
ADD COLUMN days_of_week integer[] DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN checklist_items.days_of_week IS 'Array of day numbers (0=Sunday, 1=Monday, etc.) for weekly templates';