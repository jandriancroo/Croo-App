-- Add requires_temperature_validation column to checklist_items
ALTER TABLE public.checklist_items 
ADD COLUMN requires_temperature_validation boolean NOT NULL DEFAULT false;