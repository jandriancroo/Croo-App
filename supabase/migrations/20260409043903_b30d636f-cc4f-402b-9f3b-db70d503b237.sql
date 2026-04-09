
-- Create Theo's knowledge/memory table
CREATE TABLE public.theo_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  topic TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  embedding vector(768),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for location filtering
CREATE INDEX idx_theo_knowledge_location ON public.theo_knowledge(location_id);

-- Enable RLS
ALTER TABLE public.theo_knowledge ENABLE ROW LEVEL SECURITY;

-- Managers+ at the location can read
CREATE POLICY "Managers can view location knowledge"
ON public.theo_knowledge FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    JOIN public.user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = theo_knowledge.location_id
      AND ur.role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
  )
);

-- Managers+ can insert
CREATE POLICY "Managers can save knowledge"
ON public.theo_knowledge FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    JOIN public.user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = theo_knowledge.location_id
      AND ur.role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
  )
);

-- Managers+ can delete
CREATE POLICY "Managers can delete knowledge"
ON public.theo_knowledge FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    JOIN public.user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = theo_knowledge.location_id
      AND ur.role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
  )
);

-- Similarity search function for edge functions
CREATE OR REPLACE FUNCTION public.search_theo_knowledge(
  p_location_id UUID,
  p_embedding vector(768),
  p_limit INTEGER DEFAULT 3
)
RETURNS TABLE(id UUID, topic TEXT, content TEXT, similarity FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 
    tk.id,
    tk.topic,
    tk.content,
    (1 - (tk.embedding <=> p_embedding))::FLOAT AS similarity
  FROM public.theo_knowledge tk
  WHERE tk.location_id = p_location_id
    AND tk.embedding IS NOT NULL
  ORDER BY tk.embedding <=> p_embedding
  LIMIT p_limit;
$$;
