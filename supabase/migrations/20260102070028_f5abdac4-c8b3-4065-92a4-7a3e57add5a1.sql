-- Add product detail columns to inventory_items
ALTER TABLE public.inventory_items
ADD COLUMN IF NOT EXISTS pack_size TEXT,
ADD COLUMN IF NOT EXISTS pack_quantity INTEGER,
ADD COLUMN IF NOT EXISTS brand TEXT,
ADD COLUMN IF NOT EXISTS item_number TEXT,
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add comment for clarity
COMMENT ON COLUMN public.inventory_items.pack_size IS 'Full pack size string e.g. 48/2 OZ';
COMMENT ON COLUMN public.inventory_items.pack_quantity IS 'Number of units in a pack e.g. 48';
COMMENT ON COLUMN public.inventory_items.brand IS 'Product brand name';
COMMENT ON COLUMN public.inventory_items.item_number IS 'Vendor product/item number';
COMMENT ON COLUMN public.inventory_items.image_url IS 'Product thumbnail image URL';