
-- Phase 2: Add location_id to data tables

-- 1. Add location_id to checklist_submissions
ALTER TABLE public.checklist_submissions ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 2. Add location_id to chats
ALTER TABLE public.chats ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 3. Add location_id to schedules
ALTER TABLE public.schedules ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 4. Add location_id to time_punches
ALTER TABLE public.time_punches ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 5. Add location_id to logbook_entries
ALTER TABLE public.logbook_entries ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 6. Add location_id to availability_requests
ALTER TABLE public.availability_requests ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 7. Add location_id to shift_templates
ALTER TABLE public.shift_templates ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 8. Add location_id to logbook_categories (categories per location)
ALTER TABLE public.logbook_categories ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- 9. Add location_id to checklists (templates per location, or NULL for global)
ALTER TABLE public.checklists ADD COLUMN location_id UUID REFERENCES public.locations(id);

-- Migrate existing data to Hemet (default location)
UPDATE checklist_submissions SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE chats SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE schedules SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE time_punches SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE logbook_entries SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE availability_requests SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE shift_templates SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE logbook_categories SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;
UPDATE checklists SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' WHERE location_id IS NULL;

-- Create indexes for performance
CREATE INDEX idx_checklist_submissions_location ON checklist_submissions(location_id);
CREATE INDEX idx_chats_location ON chats(location_id);
CREATE INDEX idx_schedules_location ON schedules(location_id);
CREATE INDEX idx_time_punches_location ON time_punches(location_id);
CREATE INDEX idx_logbook_entries_location ON logbook_entries(location_id);
CREATE INDEX idx_availability_requests_location ON availability_requests(location_id);
CREATE INDEX idx_shift_templates_location ON shift_templates(location_id);
CREATE INDEX idx_logbook_categories_location ON logbook_categories(location_id);
CREATE INDEX idx_checklists_location ON checklists(location_id);
