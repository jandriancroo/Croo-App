ALTER TABLE public.lite_inventory_counts
  ADD COLUMN manual_sales_total numeric(12,2);

COMMENT ON COLUMN public.lite_inventory_counts.manual_sales_total IS
  'Operator-entered sales total for this period. Bridge for COGS % until real POS sync lands. Future POS integration should add a sibling nullable pos_sales_total column and resolve via COALESCE(pos_sales_total, manual_sales_total) rather than replace this field, so operators keep manual override capability.';