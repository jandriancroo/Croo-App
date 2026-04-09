CREATE UNIQUE INDEX IF NOT EXISTS idx_theo_knowledge_dedup 
ON public.theo_knowledge (location_id, topic, md5(content));