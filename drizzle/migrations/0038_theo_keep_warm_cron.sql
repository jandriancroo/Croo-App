-- lovable-cron-fallback-reviewed: keep-warm is inherently time-based (no event to hook); Jordan approved every 5 min, 05:00-23:00 LA only.
-- Keep Theo's functions warm: every 5 minutes, only 05:00-22:59 America/Los_Angeles (DST-safe).
-- Same auth as the other edge-function cron jobs: public.cron_edge_headers() (vault secret).
SELECT cron.schedule(
  'theo-keep-warm',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/' || fn,
    headers := public.cron_edge_headers(),
    body := '{"warm": true}'::jsonb
  )
  FROM unnest(ARRAY['ai-assistant', 'theo-memory', 'theo-voice']) AS fn
  WHERE extract(hour FROM (now() AT TIME ZONE 'America/Los_Angeles')) BETWEEN 5 AND 22;
  $job$
);