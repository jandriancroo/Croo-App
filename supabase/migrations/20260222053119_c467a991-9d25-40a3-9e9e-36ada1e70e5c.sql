
-- Add linked_item_id to inventory_items for duplicate SKU linking
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS linked_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL;

-- Add blended_price column to store the averaged price
ALTER TABLE public.inventory_items
ADD COLUMN IF NOT EXISTS blended_price NUMERIC;

-- Index for quick lookup of linked items
CREATE INDEX IF NOT EXISTS idx_inventory_items_linked ON public.inventory_items(linked_item_id) WHERE linked_item_id IS NOT NULL;
