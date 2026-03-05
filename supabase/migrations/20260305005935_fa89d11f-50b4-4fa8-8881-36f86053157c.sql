
-- Add position column to checklist_items (matches shift template position names)
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS position text DEFAULT NULL;

-- Add position_filtering_enabled to checklists
ALTER TABLE public.checklists ADD COLUMN IF NOT EXISTS position_filtering_enabled boolean DEFAULT false;
