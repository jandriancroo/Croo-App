CREATE UNIQUE INDEX IF NOT EXISTS pa_catalog_items_location_pa_product_uidx
  ON public.pa_catalog_items (location_id, pa_product_id)
  WHERE pa_product_id IS NOT NULL;