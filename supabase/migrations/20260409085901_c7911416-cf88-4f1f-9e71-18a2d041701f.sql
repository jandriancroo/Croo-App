
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.opus_resource_index (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'TRAINING_RESOURCE',
  opus_id TEXT,
  theo_knowledge_id UUID REFERENCES public.theo_knowledge(id) ON DELETE SET NULL,
  media_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.opus_resource_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view opus resources"
ON public.opus_resource_index FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage opus resources"
ON public.opus_resource_index FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_opus_resource_title_trgm ON public.opus_resource_index USING gin (title gin_trgm_ops);
CREATE INDEX idx_opus_resource_location ON public.opus_resource_index(location_id);
CREATE UNIQUE INDEX idx_opus_resource_unique ON public.opus_resource_index(location_id, opus_id);
