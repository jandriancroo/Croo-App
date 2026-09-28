CREATE TABLE public.theo_day_insights (
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, business_date)
);
GRANT SELECT ON public.theo_day_insights TO authenticated;
GRANT ALL ON public.theo_day_insights TO service_role;
ALTER TABLE public.theo_day_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Location members read Theo day insights" ON public.theo_day_insights
  FOR SELECT TO authenticated
  USING (location_id IN (SELECT public.get_user_location_ids(auth.uid())));