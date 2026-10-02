CREATE TABLE public.theo_voice_openers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  window_key text NOT NULL,
  window_label text NOT NULL,
  script text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, window_key)
);
GRANT ALL ON public.theo_voice_openers TO service_role;
ALTER TABLE public.theo_voice_openers ENABLE ROW LEVEL SECURITY;
-- No client policies: only the theo-voice backend function reads/writes openers.

SELECT cron.schedule('theo-voice-openers-hourly', '7 * * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/theo-voice',
    headers := public.cron_edge_headers(),
    body := '{"action":"opener_cron"}'::jsonb
  ) AS request_id;
$job$);