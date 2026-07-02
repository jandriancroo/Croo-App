ALTER TABLE public.lite_inventory_items ADD COLUMN IF NOT EXISTS pack_size text;
ALTER TABLE public.lite_vendor_invoice_items ADD COLUMN IF NOT EXISTS pack_size text;