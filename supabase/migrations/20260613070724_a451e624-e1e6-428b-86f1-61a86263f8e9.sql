CREATE TABLE public.pfg_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  invoice_number text NOT NULL,
  invoice_header_key text,
  operation_company_number text,
  customer_number text,
  pfg_delivery_id uuid REFERENCES public.pfg_orders(id) ON DELETE SET NULL,
  invoice_date date,
  delivery_date date,
  due_date date,
  subtotal numeric(12,2),
  tax numeric(12,2),
  freight numeric(12,2),
  total_amount numeric(12,2),
  status text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data jsonb,
  has_novel_skus boolean NOT NULL DEFAULT false,
  novel_sku_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, invoice_number)
);

CREATE INDEX idx_pfg_invoices_location_date ON public.pfg_invoices (location_id, invoice_date DESC);
CREATE INDEX idx_pfg_invoices_delivery ON public.pfg_invoices (pfg_delivery_id);
CREATE INDEX idx_pfg_invoices_novel ON public.pfg_invoices (location_id) WHERE has_novel_skus = true;

GRANT SELECT ON public.pfg_invoices TO authenticated;
GRANT ALL ON public.pfg_invoices TO service_role;

ALTER TABLE public.pfg_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pfg_invoices for their locations"
ON public.pfg_invoices FOR SELECT
TO authenticated
USING (public.has_location_access(auth.uid(), location_id));

CREATE TRIGGER update_pfg_invoices_updated_at
BEFORE UPDATE ON public.pfg_invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();