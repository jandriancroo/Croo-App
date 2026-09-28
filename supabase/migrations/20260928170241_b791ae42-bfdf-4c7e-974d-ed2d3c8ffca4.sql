ALTER TABLE public.brand_integration_policies DROP CONSTRAINT brand_integration_policies_integration_key_check;
ALTER TABLE public.brand_integration_policies ADD CONSTRAINT brand_integration_policies_integration_key_check
  CHECK (integration_key = ANY (ARRAY['qubeyond','clover','aloha','toast','pfg','produce_alliance','ovation']));

CREATE TABLE public.toast_sales_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  data_source text NOT NULL CHECK (data_source IN ('export','live','api')),
  net_sales numeric NOT NULL DEFAULT 0,
  guest_count integer NOT NULL DEFAULT 0,
  check_count integer NOT NULL DEFAULT 0,
  avg_ticket numeric NOT NULL DEFAULT 0,
  hourly_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  payments_data jsonb,
  raw_payload jsonb,
  flagged_no_sales boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, sale_date)
);
GRANT SELECT ON public.toast_sales_cache TO authenticated;
GRANT ALL ON public.toast_sales_cache TO service_role;
ALTER TABLE public.toast_sales_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view toast sales for their locations" ON public.toast_sales_cache
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = toast_sales_cache.location_id));

INSERT INTO public.brand_integration_policies (brand_id, integration_key, category, is_enabled)
VALUES ('89f2529c-29a5-4e71-b491-c684359ccc8a','toast','pos',true)
ON CONFLICT (brand_id, integration_key) DO UPDATE SET is_enabled = true;