CREATE TABLE public.location_pack_seen_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_template_id   uuid NOT NULL REFERENCES public.brand_inventory_templates(id) ON DELETE CASCADE,
  pack_structure_key  text NOT NULL,
  vendor_source       text NOT NULL CHECK (vendor_source IN ('pfg_bid','pfg_order','pa_catalog','pa_order','invoice')),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_pack_seen_ledger_unique
    UNIQUE (location_id, brand_template_id, pack_structure_key)
);

CREATE INDEX idx_lpsl_location_template
  ON public.location_pack_seen_ledger (location_id, brand_template_id);

CREATE INDEX idx_lpsl_last_seen_at
  ON public.location_pack_seen_ledger (last_seen_at);

GRANT SELECT ON public.location_pack_seen_ledger TO authenticated;
GRANT ALL    ON public.location_pack_seen_ledger TO service_role;

ALTER TABLE public.location_pack_seen_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with location access can read pack-seen ledger"
  ON public.location_pack_seen_ledger
  FOR SELECT
  TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

-- No INSERT/UPDATE/DELETE policies — edge functions write via service_role only.

CREATE TRIGGER trg_lpsl_updated_at
  BEFORE UPDATE ON public.location_pack_seen_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();