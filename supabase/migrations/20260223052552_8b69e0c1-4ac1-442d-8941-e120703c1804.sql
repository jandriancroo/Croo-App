-- Add shortcut_location_names to brand_inventory_templates to store secondary storage locations
ALTER TABLE public.brand_inventory_templates
ADD COLUMN shortcut_location_names text[] DEFAULT '{}';

COMMENT ON COLUMN public.brand_inventory_templates.shortcut_location_names IS 'Names of secondary storage locations (shortcuts) for this item';