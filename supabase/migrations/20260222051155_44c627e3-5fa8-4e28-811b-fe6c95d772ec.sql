-- Add user_hidden column to inventory_items
-- This flag persists through vendor syncs (PFG/PA won't re-activate hidden items)
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS user_hidden BOOLEAN NOT NULL DEFAULT false;