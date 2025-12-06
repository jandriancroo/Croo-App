-- Drop the unique constraint that only allows 1 entry per category+date
-- Safe Count and Drawer Count categories need multiple entries per day (AM/PM)
ALTER TABLE public.logbook_entries 
DROP CONSTRAINT IF EXISTS logbook_entries_category_id_entry_date_key;