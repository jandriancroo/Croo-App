
CREATE TABLE public.location_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#64748b',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_stations_location ON public.location_stations(location_id) WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_stations TO authenticated;
GRANT ALL ON public.location_stations TO service_role;

ALTER TABLE public.location_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view stations for their locations"
  ON public.location_stations FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = location_stations.location_id)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Managers can manage stations"
  ON public.location_stations FOR ALL
  TO authenticated
  USING (
    public.has_role_or_higher(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  )
  WITH CHECK (
    public.has_role_or_higher(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE TRIGGER trg_location_stations_updated_at
  BEFORE UPDATE ON public.location_stations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS stations_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.shift_templates
  ADD COLUMN IF NOT EXISTS station_id uuid REFERENCES public.location_stations(id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_shifts
  ADD COLUMN IF NOT EXISTS station_id uuid REFERENCES public.location_stations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shift_templates_station ON public.shift_templates(station_id) WHERE station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_station ON public.scheduled_shifts(station_id) WHERE station_id IS NOT NULL;
