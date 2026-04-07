ALTER TABLE public.brands 
ADD COLUMN pos_included_overrides text[] NOT NULL DEFAULT '{}';