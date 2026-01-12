-- Add AM/PM division setting to checklists
ALTER TABLE public.checklists 
ADD COLUMN enable_am_pm_division boolean DEFAULT false;

-- Add manager shift designation to checklist items (null = unassigned, 'am' = AM Manager, 'pm' = PM Manager)
ALTER TABLE public.checklist_items 
ADD COLUMN manager_shift text CHECK (manager_shift IS NULL OR manager_shift IN ('am', 'pm'));