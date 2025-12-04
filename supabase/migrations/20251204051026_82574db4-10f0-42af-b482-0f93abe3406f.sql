-- Add location_type column to locations table
ALTER TABLE public.locations 
ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'standard';

-- Create the checklist-only test location
INSERT INTO public.locations (name, location_type, address)
VALUES ('Checklist Testing', 'checklist_only', 'Test Location for Checklist Functions')
ON CONFLICT DO NOTHING;