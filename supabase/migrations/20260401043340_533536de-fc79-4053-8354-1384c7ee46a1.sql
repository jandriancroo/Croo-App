
-- Vendor invoices (metadata for each uploaded invoice)
CREATE TABLE public.vendor_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  invoice_number TEXT,
  invoice_date DATE,
  delivery_date DATE,
  total_amount NUMERIC,
  image_url TEXT,
  parsed_at TIMESTAMP WITH TIME ZONE,
  uploaded_by UUID REFERENCES auth.users(id),
  inventory_count_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Line items extracted from each invoice
CREATE TABLE public.vendor_invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  item_number TEXT,
  quantity NUMERIC,
  unit TEXT,
  unit_price NUMERIC,
  total_price NUMERIC,
  matched_item_id UUID REFERENCES public.inventory_items(id),
  matched_template_id UUID REFERENCES public.brand_inventory_templates(id),
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users can manage invoices at their locations
CREATE POLICY "Users can view invoices at their locations" ON public.vendor_invoices
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert invoices" ON public.vendor_invoices
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update their invoices" ON public.vendor_invoices
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can delete their invoices" ON public.vendor_invoices
  FOR DELETE TO authenticated USING (uploaded_by = auth.uid());

CREATE POLICY "Users can view invoice items" ON public.vendor_invoice_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert invoice items" ON public.vendor_invoice_items
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update invoice items" ON public.vendor_invoice_items
  FOR UPDATE TO authenticated USING (true);

-- Storage bucket for invoice images
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('vendor-invoices', 'vendor-invoices', false, 20971520)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload/read invoice images
CREATE POLICY "Authenticated users can upload invoices" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vendor-invoices');

CREATE POLICY "Authenticated users can view invoices" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'vendor-invoices');
