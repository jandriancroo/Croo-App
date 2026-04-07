ALTER TABLE public.brands
ADD COLUMN pos_excluded_categories text[] NOT NULL DEFAULT '{}';