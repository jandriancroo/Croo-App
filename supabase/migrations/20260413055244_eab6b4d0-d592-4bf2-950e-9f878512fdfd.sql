
-- 1. Create enum type
CREATE TYPE public.recipe_type_enum AS ENUM ('prep', 'sub_recipe', 'menu');

-- 2. Add columns
ALTER TABLE public.recipe_blueprints
  ADD COLUMN recipe_type public.recipe_type_enum DEFAULT 'menu',
  ADD COLUMN is_countable BOOLEAN NOT NULL DEFAULT false;

-- 3. Backfill: prep recipes = those with a matching brand_inventory_template where is_recipe = true
-- Match by name since blueprints don't directly reference templates
UPDATE public.recipe_blueprints rb
SET recipe_type = 'prep', is_countable = true
WHERE rb.produces_item_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.inventory_items ii
    JOIN public.brand_inventory_templates bit ON ii.brand_item_id = bit.id
    WHERE ii.id = rb.produces_item_id
      AND bit.is_recipe = true
  );

-- 4. Mark remaining blueprints with produces_item_id but no valid brand template link as sub_recipe
UPDATE public.recipe_blueprints rb
SET recipe_type = 'sub_recipe', is_countable = false
WHERE rb.produces_item_id IS NOT NULL
  AND rb.recipe_type != 'prep';

-- 5. Clear produces_item_id on non-countable recipes (sever orphan links)
UPDATE public.recipe_blueprints
SET produces_item_id = NULL
WHERE is_countable = false AND produces_item_id IS NOT NULL;

-- 6. Remaining NULL recipe_type → menu (default for sellable product formulas)
UPDATE public.recipe_blueprints
SET recipe_type = 'menu'
WHERE recipe_type IS NULL;
