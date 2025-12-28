-- Create table for user dashboard cube configurations
CREATE TABLE public.user_dashboard_cubes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  accent_color TEXT DEFAULT '#8B5CF6',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id, display_order)
);

-- Enable RLS
ALTER TABLE public.user_dashboard_cubes ENABLE ROW LEVEL SECURITY;

-- Users can only view their own cubes
CREATE POLICY "Users can view their own cubes"
  ON public.user_dashboard_cubes
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own cubes
CREATE POLICY "Users can create their own cubes"
  ON public.user_dashboard_cubes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own cubes
CREATE POLICY "Users can update their own cubes"
  ON public.user_dashboard_cubes
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own cubes
CREATE POLICY "Users can delete their own cubes"
  ON public.user_dashboard_cubes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_user_dashboard_cubes_updated_at
  BEFORE UPDATE ON public.user_dashboard_cubes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster queries
CREATE INDEX idx_user_dashboard_cubes_user_location 
  ON public.user_dashboard_cubes(user_id, location_id);