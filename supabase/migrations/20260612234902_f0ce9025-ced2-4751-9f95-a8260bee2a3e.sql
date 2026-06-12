
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS inventory_enabled boolean NOT NULL DEFAULT false;

UPDATE public.locations
SET inventory_enabled = true
WHERE id IN (
  '12c977c7-1786-4131-90f5-1eef3f96e2c6', -- Hemet
  '01a87b8b-fb29-4734-8d1b-4a47307f843c', -- Palm Desert
  'd667741f-6d4c-433e-bb22-307e817ea7f1', -- Palm Springs
  '6eda7b4b-dab1-435c-89b3-38a7a5ac0a3e', -- Rowlett
  '037bcf8d-84ef-4c3e-b4e1-a1d9ae65bc3b', -- Tuscaloosa
  '40a872fb-57b2-409d-947d-70e48948297d', -- Sandbox
  '150cfede-666a-4b5f-ae01-5bfb7bb39635'  -- Sandbox (brand)
);

CREATE INDEX IF NOT EXISTS idx_locations_inventory_enabled
  ON public.locations (inventory_enabled)
  WHERE inventory_enabled = true;
