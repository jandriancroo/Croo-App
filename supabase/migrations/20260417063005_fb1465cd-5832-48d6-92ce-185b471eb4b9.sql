-- Restore the 5 vendor_gap_alerts that were incorrectly auto-resolved
-- by the over-eager auto-resolve pass that matched against archived templates.
UPDATE public.vendor_gap_alerts
SET status = 'new', resolved_at = NULL
WHERE brand_id = '5f805404-cc7b-454b-a994-fe5901c32e6a'
  AND status = 'resolved'
  AND resolved_at >= '2026-04-17 06:24:00+00'
  AND resolved_at <= '2026-04-17 06:25:00+00';