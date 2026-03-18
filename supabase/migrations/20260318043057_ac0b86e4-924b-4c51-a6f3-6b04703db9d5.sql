
CREATE TABLE public.labor_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  insight_date DATE NOT NULL,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  dismissed_by UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, insight_date)
);

ALTER TABLE public.labor_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view insights for their locations"
  ON public.labor_insights
  FOR SELECT
  TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Service role can insert/update insights"
  ON public.labor_insights
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
