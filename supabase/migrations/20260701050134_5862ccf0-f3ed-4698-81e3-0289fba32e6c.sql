-- Repair Prosciutto config + broad backfill: any approved config with a real
-- middle tier (outer_qty > 1) should expose the packs lane. Historical rows
-- were persisted with show_inner_packs=false due to the old (inner>1) heuristic.
UPDATE public.brand_pack_configs
   SET show_inner_packs = true
 WHERE status = 'approved'
   AND show_inner_packs = false
   AND COALESCE(outer_qty, 0) > 1;