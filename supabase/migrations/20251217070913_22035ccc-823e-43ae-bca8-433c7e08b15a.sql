-- Remove the unique constraint that forces AM/PM to share the same entry
-- This allows different users to submit AM and PM safe counts as separate entries
ALTER TABLE public.logbook_entries 
DROP CONSTRAINT IF EXISTS logbook_entries_category_date_location_unique;