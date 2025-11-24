-- Create locations table
CREATE TABLE public.locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create user_locations junction table for many-to-many relationship
CREATE TABLE public.user_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id)
);

-- Enable RLS
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for locations
CREATE POLICY "Admins can manage locations"
  ON public.locations
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their assigned locations"
  ON public.locations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_locations
      WHERE user_locations.location_id = locations.id
        AND user_locations.user_id = auth.uid()
    )
  );

-- RLS Policies for user_locations
CREATE POLICY "Admins can manage user location assignments"
  ON public.user_locations
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own location assignments"
  ON public.user_locations
  FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Automatically assign admins to new locations
CREATE OR REPLACE FUNCTION public.assign_admins_to_new_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Assign all admins to the new location
  INSERT INTO public.user_locations (user_id, location_id)
  SELECT ur.user_id, NEW.id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::app_role;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_location_created
  AFTER INSERT ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_admins_to_new_location();