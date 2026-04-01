CREATE TABLE IF NOT EXISTS public.pa_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  pa_item_id text NOT NULL,
  description text NOT NULL DEFAULT '',
  pack_size text,
  category text,
  unit_price numeric,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, pa_item_id)
);

ALTER TABLE public.pa_catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on pa_catalog_items"
  ON public.pa_catalog_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read PA catalog"
  ON public.pa_catalog_items
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_pa_catalog_items_location ON public.pa_catalog_items(location_id);
CREATE INDEX idx_pa_catalog_items_pa_item_id ON public.pa_catalog_items(pa_item_id);