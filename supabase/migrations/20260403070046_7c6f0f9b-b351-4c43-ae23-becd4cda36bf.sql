
ALTER TABLE public.brand_inventory_templates
  ADD COLUMN pack_override_outer_type text,
  ADD COLUMN pack_override_outer_qty integer,
  ADD COLUMN pack_override_inner_type text,
  ADD COLUMN pack_override_inner_qty integer;

COMMENT ON COLUMN public.brand_inventory_templates.pack_override_outer_type IS 'Label for outer container: Box, Case, Bag, etc.';
COMMENT ON COLUMN public.brand_inventory_templates.pack_override_outer_qty IS 'How many inner packs (or pieces if no inner) per outer container';
COMMENT ON COLUMN public.brand_inventory_templates.pack_override_inner_type IS 'Optional label for inner container: Sleeve, Pack, Roll, Pouch, etc.';
COMMENT ON COLUMN public.brand_inventory_templates.pack_override_inner_qty IS 'How many pieces per inner container (null = single layer)';
