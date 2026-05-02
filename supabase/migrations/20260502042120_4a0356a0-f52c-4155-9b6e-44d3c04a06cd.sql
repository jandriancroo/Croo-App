ALTER TABLE public.inventory_count_items
ADD COLUMN IF NOT EXISTS pan_inputs jsonb;

COMMENT ON COLUMN public.inventory_count_items.pan_inputs IS
'Raw pan/Cambro inputs at save time, keyed by pan_key (e.g. {"full_pan": 2, "half_pan": 1}). Used to rehydrate the Edit Count UI exactly as entered, preventing double-counting when reopening saved counts. Nullable; NULL = no pan inputs were entered for this line.';