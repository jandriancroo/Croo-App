-- Add Produce Alliance tracking columns to inventory_items
ALTER TABLE public.inventory_items
ADD COLUMN IF NOT EXISTS pa_item_id TEXT,
ADD COLUMN IF NOT EXISTS vendor_source TEXT DEFAULT 'manual';

-- Index for PA item lookups
CREATE INDEX IF NOT EXISTS idx_inventory_items_pa_item_id 
ON public.inventory_items (location_id, pa_item_id) 
WHERE pa_item_id IS NOT NULL;

-- Index for vendor source filtering
CREATE INDEX IF NOT EXISTS idx_inventory_items_vendor_source
ON public.inventory_items (location_id, vendor_source);

-- Update existing PFG items to have vendor_source = 'pfg'
UPDATE public.inventory_items 
SET vendor_source = 'pfg' 
WHERE qubeyond_item_id IS NOT NULL AND vendor_source = 'manual';
