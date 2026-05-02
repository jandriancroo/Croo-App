
DO $$
DECLARE
  v_brand_id uuid := '5f805404-cc7b-454b-a994-fe5901c32e6a';
  v_blueprint_ids uuid[] := ARRAY[
    '0a1fe6d2-0409-4f3e-937a-01b67e612f7e'::uuid, -- 17oz Dough Ball
    '5a6ac5c0-dbd0-4519-88f3-c0b98e50da31'::uuid, -- 6.8oz Dough Ball
    'fcb924fb-9207-4921-9c63-450c53c71f57'::uuid, -- Classic Red Sauce (Prepped)
    'a243cfef-4452-4e68-9650-2966dc611636'::uuid  -- Prepped Dough
  ];
BEGIN
  -- Step 1: Normalize Hemet's Classic Red Sauce inventory item to is_recipe = true
  UPDATE public.inventory_items
  SET is_recipe = true, updated_at = now()
  WHERE id = 'dde2a7bf-450e-4267-8820-84ee81cda75f';

  -- Step 2: NULL produces_item_id on the 4 brand-level blueprints
  UPDATE public.recipe_blueprints
  SET produces_item_id = NULL, updated_at = now()
  WHERE id = ANY(v_blueprint_ids)
    AND location_id IS NULL;

  -- Step 3: Clone the 4 brand blueprints into per-location copies for every active location of the brand.
  -- Skip any (blueprint, location) pair that already has a copy to keep this migration idempotent.
  WITH brand_locs AS (
    SELECT l.id AS location_id
    FROM public.locations l
    JOIN public.organizations o ON o.id = l.organization_id
    WHERE o.brand_id = v_brand_id AND l.is_active = true
  ),
  to_clone AS (
    SELECT rb.id AS source_blueprint_id, bl.location_id
    FROM public.recipe_blueprints rb
    CROSS JOIN brand_locs bl
    WHERE rb.id = ANY(v_blueprint_ids)
      AND rb.location_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.recipe_blueprints existing
        WHERE existing.brand_id = v_brand_id
          AND existing.location_id = bl.location_id
          AND existing.name = rb.name
          AND existing.is_active = true
      )
  ),
  inserted_copies AS (
    INSERT INTO public.recipe_blueprints (
      brand_id, location_id, name, category, yield_qty, yield_unit,
      produces_item_id, source, r365_name, is_active, catalog_section,
      recipe_type, is_countable
    )
    SELECT
      rb.brand_id,
      tc.location_id,
      rb.name,
      rb.category,
      rb.yield_qty,
      rb.yield_unit,
      -- Step 4: pre-link to existing local inventory item where present
      ii.id AS produces_item_id,
      rb.source,
      rb.r365_name,
      true,
      rb.catalog_section,
      rb.recipe_type,
      rb.is_countable
    FROM to_clone tc
    JOIN public.recipe_blueprints rb ON rb.id = tc.source_blueprint_id
    LEFT JOIN public.inventory_items ii
      ON ii.location_id = tc.location_id
     AND ii.brand_item_id = (
       -- map source brand blueprint -> the brand_inventory_template id used by Hemet's working item
       SELECT hemet_item.brand_item_id
       FROM public.inventory_items hemet_item
       WHERE hemet_item.id IN (
         '434cfc05-4af9-46c8-a6fa-24c65513f7f0',
         '61ec07fc-2e45-4f55-b05f-8012f6e7a72c',
         'dde2a7bf-450e-4267-8820-84ee81cda75f',
         'e6f3115a-d59e-439b-9654-90bfb7e3d8c7'
       )
       AND hemet_item.brand_item_id IS NOT NULL
       AND CASE rb.id
             WHEN '0a1fe6d2-0409-4f3e-937a-01b67e612f7e'::uuid THEN hemet_item.id = '434cfc05-4af9-46c8-a6fa-24c65513f7f0'
             WHEN '5a6ac5c0-dbd0-4519-88f3-c0b98e50da31'::uuid THEN hemet_item.id = '61ec07fc-2e45-4f55-b05f-8012f6e7a72c'
             WHEN 'fcb924fb-9207-4921-9c63-450c53c71f57'::uuid THEN hemet_item.id = 'dde2a7bf-450e-4267-8820-84ee81cda75f'
             WHEN 'a243cfef-4452-4e68-9650-2966dc611636'::uuid THEN hemet_item.id = 'e6f3115a-d59e-439b-9654-90bfb7e3d8c7'
           END
     )
    RETURNING id, name, location_id
  )
  -- Clone ingredients from each source brand blueprint to its new per-location copies
  INSERT INTO public.recipe_blueprint_ingredients (
    blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id,
    quantity, unit, source_name
  )
  SELECT
    ic.id,
    ing.ingredient_type,
    ing.vendor_item_id,
    ing.sub_blueprint_id,
    ing.quantity,
    ing.unit,
    ing.source_name
  FROM inserted_copies ic
  JOIN public.recipe_blueprints src
    ON src.brand_id = v_brand_id
   AND src.location_id IS NULL
   AND src.name = ic.name
   AND src.id = ANY(v_blueprint_ids)
  JOIN public.recipe_blueprint_ingredients ing ON ing.blueprint_id = src.id;
END $$;
