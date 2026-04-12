-- Create inventory_waste_logs table
CREATE TABLE public.inventory_waste_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT NOT NULL,
  photo_url TEXT,
  estimated_cost NUMERIC,
  logged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_waste_logs ENABLE ROW LEVEL SECURITY;

-- Shift manager+ at location can view
CREATE POLICY "shift_manager_select_waste_logs"
ON public.inventory_waste_logs FOR SELECT
TO authenticated
USING (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

-- Shift manager+ at location can create
CREATE POLICY "shift_manager_insert_waste_logs"
ON public.inventory_waste_logs FOR INSERT
TO authenticated
WITH CHECK (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

-- Manager+ can delete
CREATE POLICY "manager_delete_waste_logs"
ON public.inventory_waste_logs FOR DELETE
TO authenticated
USING (
  public.has_location_access(auth.uid(), location_id)
  AND public.has_role_or_higher(auth.uid(), 'manager')
);

-- Index for efficient queries
CREATE INDEX idx_waste_logs_location_date ON public.inventory_waste_logs (location_id, created_at DESC);

-- Storage bucket for waste photos
INSERT INTO storage.buckets (id, name, public) VALUES ('waste-photos', 'waste-photos', true);

-- Anyone can view waste photos
CREATE POLICY "waste_photos_public_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'waste-photos');

-- Shift manager+ can upload waste photos
CREATE POLICY "waste_photos_shift_manager_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'waste-photos'
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

-- Shift manager+ can delete their waste photos
CREATE POLICY "waste_photos_shift_manager_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'waste-photos'
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);