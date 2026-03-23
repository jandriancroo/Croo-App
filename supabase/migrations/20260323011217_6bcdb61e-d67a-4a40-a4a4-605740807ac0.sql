
-- Phase 3: Drop legacy BOM tables and bom_menu_item_id column

-- 1. Drop the FK constraint and column from inventory_product_groups
ALTER TABLE public.inventory_product_groups DROP CONSTRAINT IF EXISTS inventory_product_groups_bom_menu_item_id_fkey;
ALTER TABLE public.inventory_product_groups DROP COLUMN IF EXISTS bom_menu_item_id;

-- 2. Drop bom_recipe_ingredients (depends on bom_menu_items and bom_ingredients)
DROP TABLE IF EXISTS public.bom_recipe_ingredients;

-- 3. Drop bom_import_items (depends on bom_import_batches)
DROP TABLE IF EXISTS public.bom_import_items;

-- 4. Drop bom_import_batches
DROP TABLE IF EXISTS public.bom_import_batches;

-- 5. Drop bom_ingredients
DROP TABLE IF EXISTS public.bom_ingredients;

-- 6. Drop bom_menu_items
DROP TABLE IF EXISTS public.bom_menu_items;
