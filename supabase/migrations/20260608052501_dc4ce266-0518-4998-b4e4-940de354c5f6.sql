CREATE TABLE public.pfg_bid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  item_number text NOT NULL,
  description text NOT NULL DEFAULT '',
  pack_size text,
  category text,
  brand_name text,
  unit_price numeric,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pfg_bid_items_location_item_unique UNIQUE (location_id, item_number)
);

CREATE INDEX idx_pfg_bid_items_location ON public.pfg_bid_items (location_id);
CREATE INDEX idx_pfg_bid_items_item_number ON public.pfg_bid_items (item_number);
CREATE INDEX idx_pfg_bid_items_last_seen ON public.pfg_bid_items (last_seen_at);

GRANT SELECT ON public.pfg_bid_items TO authenticated;
GRANT ALL ON public.pfg_bid_items TO service_role;

ALTER TABLE public.pfg_bid_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read PFG bid items"
  ON public.pfg_bid_items
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access on pfg_bid_items"
  ON public.pfg_bid_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);