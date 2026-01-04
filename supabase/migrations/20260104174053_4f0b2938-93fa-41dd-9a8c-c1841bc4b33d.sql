-- Create inventory schedule settings table
CREATE TABLE public.inventory_schedule_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'weekly', -- 'weekly', 'monthly', 'yearly'
  day_of_week INTEGER, -- 0-6 for weekly (0=Sunday)
  day_of_month INTEGER, -- 1-31 for monthly
  month_of_year INTEGER, -- 1-12 for yearly
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id, frequency)
);

-- Enable RLS
ALTER TABLE public.inventory_schedule_settings ENABLE ROW LEVEL SECURITY;

-- Policies: admins and managers at the location can manage settings
CREATE POLICY "Users can view inventory schedule settings for their location"
ON public.inventory_schedule_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.location_id = inventory_schedule_settings.location_id
    AND ul.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can manage inventory schedule settings"
ON public.inventory_schedule_settings
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role IN ('admin', 'super_admin')
  )
);

-- Create trigger for updated_at
CREATE TRIGGER update_inventory_schedule_settings_updated_at
BEFORE UPDATE ON public.inventory_schedule_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();