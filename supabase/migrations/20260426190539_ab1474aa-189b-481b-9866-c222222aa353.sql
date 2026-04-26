-- ============================================================
-- RETENTION JANITOR: 6 prune helpers + photo archive log
-- ============================================================

-- 1. alert_queue: drop already-delivered alerts > N days old
CREATE OR REPLACE FUNCTION public.prune_alert_queue(days_to_keep integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.alert_queue
    WHERE push_sent = true
      AND push_sent_at IS NOT NULL
      AND push_sent_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

-- 2. email_queue: drop already-sent emails > N days old
CREATE OR REPLACE FUNCTION public.prune_email_queue(days_to_keep integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.email_queue
    WHERE status = 'sent'
      AND sent_at IS NOT NULL
      AND sent_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

-- 3. inventory_count_audit_log: drop edits > N days old (default 90)
CREATE OR REPLACE FUNCTION public.prune_inventory_count_audit_log(days_to_keep integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.inventory_count_audit_log
    WHERE logged_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

-- 4. pfg_refresh_audit: drop diagnostic logs > N days old
CREATE OR REPLACE FUNCTION public.prune_pfg_refresh_audit(days_to_keep integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.pfg_refresh_audit
    WHERE created_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

-- 5. punch_clock_attempts: drop kiosk attempts > N days old
CREATE OR REPLACE FUNCTION public.prune_punch_clock_attempts(days_to_keep integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.punch_clock_attempts
    WHERE created_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

-- 6. checklist_notification_logs: drop reminder records > N days old
CREATE OR REPLACE FUNCTION public.prune_checklist_notification_logs(days_to_keep integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.checklist_notification_logs
    WHERE sent_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$$;

-- ============================================================
-- CHECKLIST PHOTO ARCHIVE LOG (tracks thumbnail/delete actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.checklist_photo_archive_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid,
  storage_path text NOT NULL,
  action text NOT NULL CHECK (action IN ('thumbnailed', 'deleted')),
  original_size_bytes integer,
  new_size_bytes integer,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_archive_log_path
  ON public.checklist_photo_archive_log(storage_path);

CREATE INDEX IF NOT EXISTS idx_photo_archive_log_processed
  ON public.checklist_photo_archive_log(processed_at DESC);

ALTER TABLE public.checklist_photo_archive_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view archive log"
ON public.checklist_photo_archive_log
FOR SELECT
TO authenticated
USING ((SELECT public.has_role(auth.uid(), 'super_admin'::app_role)));

CREATE POLICY "Super admins can insert archive log"
ON public.checklist_photo_archive_log
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.has_role(auth.uid(), 'super_admin'::app_role)));