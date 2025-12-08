-- Fix PUBLIC_DATA_EXPOSURE: logbook_entry_values publicly readable
-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Everyone can view entry values" ON logbook_entry_values;

-- Create authenticated, location-scoped SELECT policy
CREATE POLICY "Users can view entry values at their locations"
ON logbook_entry_values FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM logbook_entries le
    WHERE le.id = logbook_entry_values.entry_id
    AND has_location_access(auth.uid(), le.location_id)
  )
);

-- Fix logbook_fields - currently has "Everyone can view fields" which is public
DROP POLICY IF EXISTS "Everyone can view fields" ON logbook_fields;

-- Create authenticated-only policy for logbook fields
CREATE POLICY "Authenticated users can view fields"
ON logbook_fields FOR SELECT TO authenticated
USING (true);

-- Fix checklist_items - "Anyone can view" should require authentication
DROP POLICY IF EXISTS "Anyone can view checklist items" ON checklist_items;

CREATE POLICY "Authenticated users can view checklist items"
ON checklist_items FOR SELECT TO authenticated
USING (true);

-- Fix checklist_role_tags - "Anyone can view" should require authentication  
DROP POLICY IF EXISTS "Anyone can view checklist role tags" ON checklist_role_tags;

CREATE POLICY "Authenticated users can view checklist role tags"
ON checklist_role_tags FOR SELECT TO authenticated
USING (true);