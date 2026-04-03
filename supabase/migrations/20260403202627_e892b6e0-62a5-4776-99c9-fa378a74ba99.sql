
-- Step 1: Create brand_vendor_mappings table
CREATE TABLE public.brand_vendor_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_template_id uuid NOT NULL REFERENCES public.brand_inventory_templates(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  vendor_item_id text NOT NULL,
  territory text,
  source_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  pack_override_outer_type text,
  pack_override_outer_qty integer,
  pack_override_inner_type text,
  pack_override_inner_qty integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_template_id, vendor, vendor_item_id)
);

-- Enable RLS
ALTER TABLE public.brand_vendor_mappings ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated brand member can see mappings for their brand's templates
CREATE POLICY "Brand members can view vendor mappings"
  ON public.brand_vendor_mappings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates bit
      JOIN public.brand_members bm ON bm.brand_id = bit.brand_id
      WHERE bit.id = brand_template_id
        AND bm.user_id = auth.uid()
    )
    OR public.is_super_admin(auth.uid())
  );

-- Insert: brand admins + super admins
CREATE POLICY "Brand admins can insert vendor mappings"
  ON public.brand_vendor_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates bit
      JOIN public.brand_members bm ON bm.brand_id = bit.brand_id
      WHERE bit.id = brand_template_id
        AND bm.user_id = auth.uid()
        AND bm.brand_role = 'admin'
    )
    OR public.is_super_admin(auth.uid())
  );

-- Update: brand admins + super admins
CREATE POLICY "Brand admins can update vendor mappings"
  ON public.brand_vendor_mappings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates bit
      JOIN public.brand_members bm ON bm.brand_id = bit.brand_id
      WHERE bit.id = brand_template_id
        AND bm.user_id = auth.uid()
        AND bm.brand_role = 'admin'
    )
    OR public.is_super_admin(auth.uid())
  );

-- Delete: brand admins + super admins
CREATE POLICY "Brand admins can delete vendor mappings"
  ON public.brand_vendor_mappings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates bit
      JOIN public.brand_members bm ON bm.brand_id = bit.brand_id
      WHERE bit.id = brand_template_id
        AND bm.user_id = auth.uid()
        AND bm.brand_role = 'admin'
    )
    OR public.is_super_admin(auth.uid())
  );

-- Index for fast lookups by vendor + item ID (the sync hot path)
CREATE INDEX idx_brand_vendor_mappings_vendor_item
  ON public.brand_vendor_mappings (vendor, vendor_item_id);

-- Index for lookups by template
CREATE INDEX idx_brand_vendor_mappings_template
  ON public.brand_vendor_mappings (brand_template_id);
