DELETE FROM public.brand_pack_configs
WHERE status = 'proposed'
  AND source LIKE 'vendor_sync:%';