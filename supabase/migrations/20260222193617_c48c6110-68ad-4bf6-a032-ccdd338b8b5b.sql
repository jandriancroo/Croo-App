-- Add countable flag to inventory_items for recipe visibility in counts
-- Defaults to true so existing recipe items remain countable
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS countable boolean NOT NULL DEFAULT true;