
-- Add mapping_type to inventory_product_groups for salad reconciliation engine
-- Values: 'direct' (default, 1:1 POS→blueprint), 'named_parent' (known size+variety),
--         'generic_parent' (known size, variety via PMIX), 'variety_mod' (variety signal, not depleted directly)
ALTER TABLE public.inventory_product_groups 
  ADD COLUMN IF NOT EXISTS mapping_type text NOT NULL DEFAULT 'direct';

-- Add variety_mod_config for generic_parent mappings to know which variety blueprints to distribute across
-- JSON array of { "mod_name": "Classic Caesar", "blueprint_id": "uuid-of-caesar-core-MI" }
ALTER TABLE public.inventory_product_groups 
  ADD COLUMN IF NOT EXISTS reconciliation_group text DEFAULT NULL;

COMMENT ON COLUMN public.inventory_product_groups.mapping_type IS 
  'Reconciliation role: direct (1:1), named_parent (entree with known variety), generic_parent (needs PMIX), variety_mod (PMIX signal only)';

COMMENT ON COLUMN public.inventory_product_groups.reconciliation_group IS 
  'Groups related mappings for reconciliation (e.g., "salads" groups all salad-related mappings together)';
