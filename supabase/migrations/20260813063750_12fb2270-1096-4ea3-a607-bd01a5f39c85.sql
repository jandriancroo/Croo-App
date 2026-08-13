-- Refund corrections for Georgetown (Clover). Refunded item value reduces net
-- sales; refunded tax/tips are not part of net sales.
UPDATE public.clover_sales_cache SET net_sales = 1382.40, avg_ticket = 1382.40 / 82
WHERE location_id = '79456db0-c817-464e-a849-bca44f8d6f34' AND sale_date = '2026-07-07';
UPDATE public.sales_cache SET net_sales = 1382.40, avg_ticket = 1382.40 / 82
WHERE location_id = '79456db0-c817-464e-a849-bca44f8d6f34' AND sale_date = '2026-07-07';

UPDATE public.clover_sales_cache SET net_sales = 1136.97, avg_ticket = 1136.97 / 71
WHERE location_id = '79456db0-c817-464e-a849-bca44f8d6f34' AND sale_date = '2026-08-12';
UPDATE public.sales_cache SET net_sales = 1136.97, avg_ticket = 1136.97 / 71
WHERE location_id = '79456db0-c817-464e-a849-bca44f8d6f34' AND sale_date = '2026-08-12';

-- Refunded card tip ($4.50) leaves the Aug 12 tip pool.
UPDATE public.daily_tips
SET total_cc_tips = GREATEST(0, total_cc_tips - 4.50)
WHERE location_id = '79456db0-c817-464e-a849-bca44f8d6f34' AND tip_date = '2026-08-12';