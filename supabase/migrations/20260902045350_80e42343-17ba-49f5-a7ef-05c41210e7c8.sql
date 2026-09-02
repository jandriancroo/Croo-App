-- Retire the legacy vendor jobs superseded by the single nightly vendor run
-- (vendor-sync-nightly, 3:20 AM Pacific). Guarded so re-running is safe.
DO $$
DECLARE
  j text;
  dropped text[] := '{}';
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'nightly-vendor-gap-scan',            -- duplicate gap scan (10:15 UTC)
    'vendor-gap-scan-nightly',            -- duplicate gap scan (12:00 UTC)
    'pfg-scheduled-price-sync-every-8h',  -- wrote cost_per_unit outside the new price chain
    'nightly-pack-config-seeder'          -- now stage 7 inside vendor-sync-nightly
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
      dropped := dropped || j;
    END IF;
  END LOOP;
  RAISE NOTICE 'unscheduled: %', dropped;
END $$;