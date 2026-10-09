ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS station_id uuid NULL REFERENCES public.location_stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_role public.app_role NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS checklist_items_station_id_idx ON public.checklist_items(station_id) WHERE station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS checklist_items_assigned_user_id_idx ON public.checklist_items(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
COMMENT ON COLUMN public.checklist_items.position IS 'Position-mode assignment; one of position/station_id/assigned_role/assigned_user_id is set (or none).';