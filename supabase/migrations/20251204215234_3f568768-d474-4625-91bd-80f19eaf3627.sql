-- Create food safety audits table for location-level audits
CREATE TABLE public.food_safety_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  audit_url TEXT NOT NULL,
  audit_date DATE NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.food_safety_audits ENABLE ROW LEVEL SECURITY;

-- Users can view audits at their locations
CREATE POLICY "Users can view audits at their locations"
ON public.food_safety_audits
FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- Admins can manage audits at their locations
CREATE POLICY "Admins can manage audits"
ON public.food_safety_audits
FOR ALL
USING (
  is_super_admin(auth.uid()) OR 
  (has_role(auth.uid(), 'admin'::app_role) AND has_location_access(auth.uid(), location_id))
)
WITH CHECK (
  is_super_admin(auth.uid()) OR 
  (has_role(auth.uid(), 'admin'::app_role) AND has_location_access(auth.uid(), location_id))
);

-- Create storage bucket for audits
INSERT INTO storage.buckets (id, name, public) VALUES ('food-safety-audits', 'food-safety-audits', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for audits bucket
CREATE POLICY "Admins can upload audits"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'food-safety-audits' AND (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Anyone can view audits"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'food-safety-audits');

CREATE POLICY "Admins can delete audits"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'food-safety-audits' AND (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);