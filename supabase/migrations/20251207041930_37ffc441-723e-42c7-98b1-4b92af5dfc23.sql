-- Create table for location-specific API integrations
CREATE TABLE public.location_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id, integration_type)
);

-- Enable RLS
ALTER TABLE public.location_integrations ENABLE ROW LEVEL SECURITY;

-- Only admins at the location can view/manage integrations
CREATE POLICY "Admins can manage integrations at their locations"
  ON public.location_integrations
  FOR ALL
  USING (is_super_admin(auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND has_location_access(auth.uid(), location_id)))
  WITH CHECK (is_super_admin(auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND has_location_access(auth.uid(), location_id)));

-- Add updated_at trigger
CREATE TRIGGER update_location_integrations_updated_at
  BEFORE UPDATE ON public.location_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();