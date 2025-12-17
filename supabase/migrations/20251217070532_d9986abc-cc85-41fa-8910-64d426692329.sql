-- Fix logbook_entry_values INSERT policy to allow users at a location to add values to an existing entry
-- (prevents RLS failures when a different user submits PM safe count for same day/category/location)

ALTER TABLE public.logbook_entry_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create entry values" ON public.logbook_entry_values;

CREATE POLICY "Users can create entry values at their locations"
ON public.logbook_entry_values
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.logbook_entries le
    WHERE le.id = logbook_entry_values.entry_id
      AND public.has_location_access(auth.uid(), le.location_id)
  )
);