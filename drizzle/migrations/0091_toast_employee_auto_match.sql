-- Toast auto-match log, plus the moment each Toast employee was first seen.
-- The matcher in toast-sync writes with the service role. Manual mapping rows stay put.
-- Managers can read the log for their store. Clients cannot insert it.
--
-- Digest cron: every 15 minutes the toast-match-digest function checks each Toast
-- store's own timezone and sends once during the 2 AM hour and once during the
-- noon hour. Empty windows are not queued. Dedup is one row per store, local date, and slot.
-- target_date is left null so idx_email_queue_dedup_simple does not collapse the two daily sends.

ALTER TABLE public.toast_employee_mappings
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;
UPDATE public.toast_employee_mappings
  SET first_seen_at = created_at
  WHERE first_seen_at IS NULL;
ALTER TABLE public.toast_employee_mappings
  ALTER COLUMN first_seen_at SET DEFAULT now(),
  ALTER COLUMN first_seen_at SET NOT NULL;

ALTER TABLE public.toast_employees
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;
UPDATE public.toast_employees
  SET first_seen_at = created_at
  WHERE first_seen_at IS NULL;
ALTER TABLE public.toast_employees
  ALTER COLUMN first_seen_at SET DEFAULT now(),
  ALTER COLUMN first_seen_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.toast_keep_first_seen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_seen_at IS NOT NULL THEN
    NEW.first_seen_at := LEAST(OLD.first_seen_at, COALESCE(NEW.first_seen_at, OLD.first_seen_at));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.toast_keep_first_seen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_toast_mappings_keep_first_seen ON public.toast_employee_mappings;
CREATE TRIGGER trg_toast_mappings_keep_first_seen
  BEFORE UPDATE ON public.toast_employee_mappings
  FOR EACH ROW EXECUTE FUNCTION public.toast_keep_first_seen();

DROP TRIGGER IF EXISTS trg_toast_employees_keep_first_seen ON public.toast_employees;
CREATE TRIGGER trg_toast_employees_keep_first_seen
  BEFORE UPDATE ON public.toast_employees
  FOR EACH ROW EXECUTE FUNCTION public.toast_keep_first_seen();

CREATE TABLE IF NOT EXISTS public.toast_match_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  toast_user_id text NOT NULL,
  toast_name text,
  outcome text NOT NULL CHECK (outcome IN ('linked', 'ambiguous', 'none', 'skipped_taken')),
  method text CHECK (method IS NULL OR method IN ('email', 'phone', 'exact_name', 'levenshtein', 'nickname')),
  score numeric CHECK (score IS NULL OR score >= 0),
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidates) = 'array'),
  croo_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS toast_match_attempts_location_created_idx
  ON public.toast_match_attempts (location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS toast_match_attempts_employee_idx
  ON public.toast_match_attempts (location_id, toast_user_id, created_at DESC);

REVOKE ALL ON TABLE public.toast_match_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.toast_match_attempts TO authenticated;
GRANT ALL ON TABLE public.toast_match_attempts TO service_role;

ALTER TABLE public.toast_match_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read toast match attempts" ON public.toast_match_attempts;
CREATE POLICY "Managers read toast match attempts"
  ON public.toast_match_attempts
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_or_higher(auth.uid(), 'shift_manager')
    AND public.has_location_access(auth.uid(), location_id)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toast-match-digest') THEN
    PERFORM cron.unschedule('toast-match-digest');
  END IF;
END $$;

SELECT cron.schedule(
  'toast-match-digest',
  '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/toast-match-digest',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  );
  $job$
);
