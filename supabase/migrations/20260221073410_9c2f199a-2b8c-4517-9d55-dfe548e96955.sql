-- Update PFG keep-alive cron to run every 4 hours instead of every 8 hours
-- PFG refresh tokens expire in ~5 hours, so 8h was too long
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'pfg-keep-alive-every-8h'),
  schedule := '0 */4 * * *'
);