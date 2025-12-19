-- Create table for OvationUp integration settings (brand-level)
CREATE TABLE public.ovation_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  auth_token TEXT,
  token_updated_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(brand_id)
);

-- Create table for mapping OvationUp location IDs to our locations
CREATE TABLE public.ovation_location_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  ovation_location_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id),
  UNIQUE(ovation_location_id)
);

-- Enable RLS
ALTER TABLE public.ovation_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ovation_location_mappings ENABLE ROW LEVEL SECURITY;

-- Policies for ovation_integrations (brand admins and super admins)
CREATE POLICY "Brand admins can view ovation integrations"
  ON public.ovation_integrations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = ovation_integrations.brand_id
      AND bm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

CREATE POLICY "Brand admins can manage ovation integrations"
  ON public.ovation_integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = ovation_integrations.brand_id
      AND bm.user_id = auth.uid()
      AND bm.brand_role IN ('admin', 'owner')
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Policies for ovation_location_mappings
CREATE POLICY "Users can view ovation location mappings"
  ON public.ovation_location_mappings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.location_id = ovation_location_mappings.location_id
      AND ul.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

CREATE POLICY "Admins can manage ovation location mappings"
  ON public.ovation_location_mappings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin', 'org_admin')
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_ovation_integrations_updated_at
  BEFORE UPDATE ON public.ovation_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();