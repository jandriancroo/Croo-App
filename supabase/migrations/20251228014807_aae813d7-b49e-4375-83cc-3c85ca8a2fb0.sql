-- Add a table to store user's dashboard section preferences
CREATE TABLE public.user_dashboard_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id, section_key)
);

-- Enable RLS
ALTER TABLE public.user_dashboard_sections ENABLE ROW LEVEL SECURITY;

-- Users can manage their own dashboard sections
CREATE POLICY "Users can view their own dashboard sections"
ON public.user_dashboard_sections
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dashboard sections"
ON public.user_dashboard_sections
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dashboard sections"
ON public.user_dashboard_sections
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dashboard sections"
ON public.user_dashboard_sections
FOR DELETE
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_user_dashboard_sections_updated_at
BEFORE UPDATE ON public.user_dashboard_sections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();