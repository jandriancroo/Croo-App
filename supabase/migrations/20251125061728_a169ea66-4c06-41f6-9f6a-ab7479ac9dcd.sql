-- Add assigned_day_of_week column to checklists table for dynamic templates
-- 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
-- NULL for standard checklists (always visible)
ALTER TABLE checklists 
ADD COLUMN assigned_day_of_week integer CHECK (assigned_day_of_week >= 0 AND assigned_day_of_week <= 6);