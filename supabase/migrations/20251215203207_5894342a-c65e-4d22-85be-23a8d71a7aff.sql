-- Add unique constraint for logbook entries upsert to work properly
ALTER TABLE public.logbook_entries 
ADD CONSTRAINT logbook_entries_category_date_location_unique 
UNIQUE (category_id, entry_date, location_id);