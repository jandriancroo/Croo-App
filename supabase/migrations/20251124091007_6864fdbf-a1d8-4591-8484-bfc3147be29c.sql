-- Create certifications table
CREATE TABLE public.certifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  certification_type TEXT NOT NULL CHECK (certification_type IN ('food_handlers', 'servsafe')),
  certificate_url TEXT NOT NULL,
  expiration_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;

-- Users can view own certifications
CREATE POLICY "Users can view own certifications"
  ON public.certifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create own certifications
CREATE POLICY "Users can create own certifications"
  ON public.certifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Admins can view all certifications
CREATE POLICY "Admins can view all certifications"
  ON public.certifications
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Admins can update certifications
CREATE POLICY "Admins can update certifications"
  ON public.certifications
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- Admins can delete certifications
CREATE POLICY "Admins can delete certifications"
  ON public.certifications
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'));

-- Create storage bucket for certificates
INSERT INTO storage.buckets (id, name, public)
VALUES ('certificates', 'certificates', false);

-- Storage policies for certificates
CREATE POLICY "Users can upload own certificates"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'certificates' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own certificates"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'certificates' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Admins can view all certificates"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'certificates' 
    AND has_role(auth.uid(), 'admin')
  );

-- Add trigger for updated_at
CREATE TRIGGER update_certifications_updated_at
  BEFORE UPDATE ON public.certifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();