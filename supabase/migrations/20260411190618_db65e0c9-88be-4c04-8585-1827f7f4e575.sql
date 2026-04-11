
-- Add vendor_territory to locations
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS vendor_territory text;

-- Create vendor SKU health status enum
DO $$ BEGIN
  CREATE TYPE public.vendor_sku_status AS ENUM ('active', 'stale', 'discontinued');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create vendor_sku_health table
CREATE TABLE public.vendor_sku_health (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  vendor_source text NOT NULL,
  vendor_sku text NOT NULL,
  vendor_territory text NOT NULL DEFAULT 'unknown',
  status vendor_sku_status NOT NULL DEFAULT 'active',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_price numeric,
  last_location_id uuid REFERENCES public.locations(id),
  product_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, vendor_source, vendor_sku, vendor_territory)
);

-- Indexes for common queries
CREATE INDEX idx_vendor_sku_health_brand ON public.vendor_sku_health(brand_id);
CREATE INDEX idx_vendor_sku_health_status ON public.vendor_sku_health(brand_id, status);
CREATE INDEX idx_vendor_sku_health_last_seen ON public.vendor_sku_health(last_seen_at);
CREATE INDEX idx_locations_vendor_territory ON public.locations(vendor_territory) WHERE vendor_territory IS NOT NULL;

-- Enable RLS
ALTER TABLE public.vendor_sku_health ENABLE ROW LEVEL SECURITY;

-- Brand admins + super admins can view health records for their brand
CREATE POLICY "Brand members can view vendor SKU health"
  ON public.vendor_sku_health
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = vendor_sku_health.brand_id
        AND bm.user_id = auth.uid()
    )
  );

-- Brand admins + super admins can manage health records
CREATE POLICY "Brand admins can manage vendor SKU health"
  ON public.vendor_sku_health
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = vendor_sku_health.brand_id
        AND bm.user_id = auth.uid()
        AND bm.brand_role = 'admin'
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = vendor_sku_health.brand_id
        AND bm.user_id = auth.uid()
        AND bm.brand_role = 'admin'
    )
  );

-- Auto-update updated_at
CREATE TRIGGER update_vendor_sku_health_updated_at
  BEFORE UPDATE ON public.vendor_sku_health
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
