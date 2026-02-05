-- Add product_mix column to sales_cache to store cached product mix data
ALTER TABLE public.sales_cache 
ADD COLUMN IF NOT EXISTS product_mix JSONB;