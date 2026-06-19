ALTER TABLE public.pa_catalog_items
  ADD COLUMN IF NOT EXISTS pa_product_id        text,
  ADD COLUMN IF NOT EXISTS master_product_code  text,
  ADD COLUMN IF NOT EXISTS master_product_id    text;

CREATE INDEX IF NOT EXISTS idx_pa_catalog_pa_product_id
  ON public.pa_catalog_items (pa_product_id);
CREATE INDEX IF NOT EXISTS idx_pa_catalog_master_product_code
  ON public.pa_catalog_items (master_product_code);
CREATE INDEX IF NOT EXISTS idx_pa_catalog_master_product_id
  ON public.pa_catalog_items (master_product_id);

COMMENT ON COLUMN public.pa_catalog_items.pa_product_id IS
  'PA "Product ID" - the value PA prints on Weekly Pricing report, order confirmations, and invoices. AUTHORITATIVE resolution key. Sourced from restaurantWeeklyProducePricesReport.jsp.';
COMMENT ON COLUMN public.pa_catalog_items.master_product_code IS
  'PA masterProductCode - guide ID. Supporting reference only, not the resolution key.';
COMMENT ON COLUMN public.pa_catalog_items.master_product_id IS
  'PA masterProductId - internal DB primary key. Supporting reference only, not the resolution key.';
COMMENT ON COLUMN public.pa_catalog_items.pa_item_id IS
  'LEGACY - currently holds masterProductCode. Kept for backward compatibility; do not use as resolution key. Prefer pa_product_id.';