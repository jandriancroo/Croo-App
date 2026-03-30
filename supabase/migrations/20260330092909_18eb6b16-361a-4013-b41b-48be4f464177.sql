ALTER TABLE public.brand_inventory_staging 
  ADD COLUMN IF NOT EXISTS pack_size text,
  ADD COLUMN IF NOT EXISTS original_vendor_name text;