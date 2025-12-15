-- Create punch clock templates table for scheduled backgrounds/messages
CREATE TABLE public.punch_clock_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  background_url TEXT,
  overlay_text TEXT,
  text_color TEXT DEFAULT '#FFFFFF',
  start_at TIMESTAMP WITH TIME ZONE NOT NULL,
  end_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.punch_clock_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage punch clock templates"
ON public.punch_clock_templates
FOR ALL
USING (
  is_super_admin(auth.uid()) OR 
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR 
  (has_role(auth.uid(), 'admin') AND has_location_access(auth.uid(), location_id))
);

CREATE POLICY "Users can view punch clock templates at their locations"
ON public.punch_clock_templates
FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- Trigger for updated_at
CREATE TRIGGER update_punch_clock_templates_updated_at
BEFORE UPDATE ON public.punch_clock_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for efficient querying of active templates by time range
CREATE INDEX idx_punch_clock_templates_active_time 
ON public.punch_clock_templates (location_id, is_active, start_at, end_at);