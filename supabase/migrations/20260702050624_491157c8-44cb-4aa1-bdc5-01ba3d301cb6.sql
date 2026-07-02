-- ============================================================
-- LITE INVENTORY — fully isolated schema
-- No FK to brand_*; no governance triggers copied from Brand.
-- ============================================================

-- ---------- lite_inventory_items ----------
CREATE TABLE public.lite_inventory_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id            uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  item_number            text,
  vendor_name_normalized text,
  unit                   text,
  cost_per_unit          numeric(12,4) DEFAULT 0,
  is_active              boolean NOT NULL DEFAULT true,
  match_status           text NOT NULL DEFAULT 'new',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lite_inventory_items_loc_idx    ON public.lite_inventory_items (location_id);
CREATE INDEX lite_inventory_items_comp_idx   ON public.lite_inventory_items (location_id, vendor_name_normalized, item_number);
CREATE INDEX lite_inventory_items_lname_idx  ON public.lite_inventory_items (location_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_inventory_items TO authenticated;
GRANT ALL ON public.lite_inventory_items TO service_role;
ALTER TABLE public.lite_inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY lite_items_select ON public.lite_inventory_items
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_items_insert ON public.lite_inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_items_update ON public.lite_inventory_items
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_items_delete ON public.lite_inventory_items
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE TRIGGER lite_inventory_items_updated_at
  BEFORE UPDATE ON public.lite_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- lite_vendor_invoices ----------
CREATE TABLE public.lite_vendor_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  vendor_name     text,
  invoice_number  text,
  invoice_date    date,
  delivery_date   date,
  total_amount    numeric(12,2),
  status          text NOT NULL DEFAULT 'parsed',
  storage_path    text,
  parsed_at       timestamptz,
  uploaded_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lite_vendor_invoices_loc_date_idx ON public.lite_vendor_invoices (location_id, invoice_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_vendor_invoices TO authenticated;
GRANT ALL ON public.lite_vendor_invoices TO service_role;
ALTER TABLE public.lite_vendor_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY lite_invoices_select ON public.lite_vendor_invoices
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_invoices_insert ON public.lite_vendor_invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_invoices_update ON public.lite_vendor_invoices
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_invoices_delete ON public.lite_vendor_invoices
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE TRIGGER lite_vendor_invoices_updated_at
  BEFORE UPDATE ON public.lite_vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- lite_vendor_invoice_items ----------
CREATE TABLE public.lite_vendor_invoice_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES public.lite_vendor_invoices(id) ON DELETE CASCADE,
  product_name       text NOT NULL,
  item_number        text,
  quantity           numeric(12,4),
  unit               text,
  unit_price         numeric(12,4),
  total_price        numeric(12,2),
  match_status       text NOT NULL,
  matched_item_id    uuid REFERENCES public.lite_inventory_items(id) ON DELETE SET NULL,
  candidate_item_id  uuid REFERENCES public.lite_inventory_items(id) ON DELETE SET NULL,
  fuzzy_score        numeric(4,3),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lite_invoice_items_inv_idx     ON public.lite_vendor_invoice_items (invoice_id);
CREATE INDEX lite_invoice_items_matched_idx ON public.lite_vendor_invoice_items (matched_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_vendor_invoice_items TO authenticated;
GRANT ALL ON public.lite_vendor_invoice_items TO service_role;
ALTER TABLE public.lite_vendor_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY lite_invoice_items_select ON public.lite_vendor_invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lite_vendor_invoices inv
    WHERE inv.id = invoice_id
      AND public.has_location_access(auth.uid(), inv.location_id)
  ));
CREATE POLICY lite_invoice_items_insert ON public.lite_vendor_invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lite_vendor_invoices inv
    WHERE inv.id = invoice_id
      AND public.has_location_access(auth.uid(), inv.location_id)
  ));
CREATE POLICY lite_invoice_items_update ON public.lite_vendor_invoice_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lite_vendor_invoices inv
    WHERE inv.id = invoice_id
      AND public.has_location_access(auth.uid(), inv.location_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lite_vendor_invoices inv
    WHERE inv.id = invoice_id
      AND public.has_location_access(auth.uid(), inv.location_id)
  ));
CREATE POLICY lite_invoice_items_delete ON public.lite_vendor_invoice_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lite_vendor_invoices inv
    WHERE inv.id = invoice_id
      AND public.has_location_access(auth.uid(), inv.location_id)
  ));