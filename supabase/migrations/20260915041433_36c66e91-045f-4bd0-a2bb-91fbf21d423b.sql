CREATE TABLE public.vendor_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  category text,
  sync_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_integrated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vendor_registry TO authenticated;
GRANT ALL ON public.vendor_registry TO service_role;

ALTER TABLE public.vendor_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read vendor registry"
  ON public.vendor_registry FOR SELECT TO authenticated USING (true);

INSERT INTO public.vendor_registry (key, display_name, category, sync_methods, is_integrated) VALUES
  ('pfg', 'Performance Food Group', 'general food & paper', '["master_list", "order_history", "invoice_history"]'::jsonb, true),
  ('produce_alliance', 'Produce Alliance', 'produce', '["master_list", "order_history"]'::jsonb, true);