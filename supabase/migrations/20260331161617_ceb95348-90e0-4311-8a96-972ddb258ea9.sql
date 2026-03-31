CREATE TABLE public.vendor_gap_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  vendor_source TEXT NOT NULL,
  item_number TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  vendor_description TEXT,
  pack_size TEXT,
  category_name TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(brand_id, vendor_source, item_number)
);

ALTER TABLE public.vendor_gap_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand admins can view gap alerts"
  ON public.vendor_gap_alerts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = vendor_gap_alerts.brand_id
        AND bm.user_id = auth.uid()
    )
  );

CREATE POLICY "Brand admins can update gap alerts"
  ON public.vendor_gap_alerts FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = vendor_gap_alerts.brand_id
        AND bm.user_id = auth.uid()
    )
  );