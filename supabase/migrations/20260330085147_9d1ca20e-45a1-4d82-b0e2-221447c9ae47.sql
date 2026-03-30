
CREATE TABLE public.brand_inventory_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  item_number TEXT,
  vendor_source TEXT,
  category TEXT,
  matched_template_id UUID REFERENCES public.brand_inventory_templates(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'promoted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.brand_inventory_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage staging" ON public.brand_inventory_staging
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_staging_brand ON public.brand_inventory_staging(brand_id);
CREATE INDEX idx_staging_status ON public.brand_inventory_staging(brand_id, status);
