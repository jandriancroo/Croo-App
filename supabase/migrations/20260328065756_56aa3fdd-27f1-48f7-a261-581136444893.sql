
-- Brand-level event categories (master templates auto-deployed to new locations)
CREATE TABLE public.brand_event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, name)
);

ALTER TABLE public.brand_event_categories ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read brand event categories
CREATE POLICY "Authenticated users can read brand_event_categories"
  ON public.brand_event_categories FOR SELECT TO authenticated
  USING (true);

-- Only super_admin and brand_admin can manage brand event categories
CREATE POLICY "Brand admins can manage brand_event_categories"
  ON public.brand_event_categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('super_admin', 'brand_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('super_admin', 'brand_admin')
    )
  );
