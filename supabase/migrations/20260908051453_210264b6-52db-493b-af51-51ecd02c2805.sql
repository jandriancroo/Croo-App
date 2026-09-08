-- Reconciliation migration: both function bodies below were already applied live
-- on the production database on 2026-09-05 (log_logbook_audit) and 2026-09-06
-- (mark_labor_cache_stale_and_backfill). This commits the exact live definitions
-- (verified via pg_get_functiondef) into the repo. No behavior change.

CREATE OR REPLACE FUNCTION public.mark_labor_cache_stale_and_backfill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location_id UUID;
  v_timezone TEXT;
  v_new_date DATE;
  v_old_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_payload JSONB;
BEGIN
  v_location_id := COALESCE(NEW.location_id, OLD.location_id);

  IF v_location_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT timezone INTO v_timezone
  FROM location_settings
  WHERE location_id = v_location_id
  LIMIT 1;

  v_timezone := COALESCE(v_timezone, 'America/Los_Angeles');

  IF TG_OP = 'DELETE' THEN
    v_new_date := (OLD.punch_time AT TIME ZONE v_timezone)::DATE;
    v_old_date := v_new_date;
  ELSIF TG_OP = 'UPDATE' THEN
    v_new_date := (NEW.punch_time AT TIME ZONE v_timezone)::DATE;
    v_old_date := (OLD.punch_time AT TIME ZONE v_timezone)::DATE;
  ELSE
    v_new_date := (NEW.punch_time AT TIME ZONE v_timezone)::DATE;
    v_old_date := v_new_date;
  END IF;

  v_start_date := LEAST(v_old_date, v_new_date);
  v_end_date := GREATEST(v_old_date, v_new_date);

  UPDATE labor_cache
  SET is_stale = true
  WHERE location_id = v_location_id
    AND labor_date BETWEEN v_start_date AND v_end_date
    AND source = 'punch_clock';

  v_payload := jsonb_build_object(
    'action', 'backfill',
    'locationId', v_location_id::TEXT,
    'startDate', v_start_date::TEXT,
    'endDate', v_end_date::TEXT,
    'forceRefresh', true
  );

  BEGIN
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service',
      headers := public.cron_edge_headers(),
      body := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'mark_labor_cache_stale_and_backfill: net.http_post call failed: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Trigger-only execution (matches live grants)
REVOKE EXECUTE ON FUNCTION public.mark_labor_cache_stale_and_backfill() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_labor_cache_stale_and_backfill() FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_labor_cache_stale_and_backfill() FROM authenticated;

CREATE OR REPLACE FUNCTION public.log_logbook_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_record RECORD;
  v_action TEXT;
  v_entry_type TEXT;
  v_entry_title TEXT;
  v_employee_id UUID;
  v_employee_name TEXT;
  v_location_id UUID;
  v_reason TEXT;
  v_performer_name TEXT;
  v_metadata JSONB := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_record := NEW;
    v_action := 'created';
  ELSIF TG_OP = 'DELETE' THEN
    v_record := OLD;
    v_action := 'deleted';
  END IF;

  v_entry_type := TG_ARGV[0];

  CASE v_entry_type
    WHEN 'writeup' THEN
      v_employee_id := v_record.employee_id;
      v_location_id := v_record.location_id;
      v_reason := v_record.reason;
      v_entry_title := 'Write-Up: ' || v_record.reason;
      v_metadata := jsonb_build_object('is_final_warning', v_record.is_final_warning);
    WHEN 'logbook_entry' THEN
      v_employee_id := v_record.created_by;
      v_location_id := v_record.location_id;
      SELECT name INTO v_entry_title FROM logbook_categories WHERE id = v_record.category_id;
      v_entry_title := COALESCE(v_entry_title, 'Logbook Entry');
      SELECT name INTO v_reason FROM logbook_categories WHERE id = v_record.category_id;
      v_metadata := jsonb_build_object('category', v_reason, 'entry_date', v_record.entry_date);
    WHEN 'performance_review' THEN
      v_employee_id := v_record.employee_id;
      v_location_id := v_record.location_id;
      v_entry_title := 'Performance Review';
      v_metadata := jsonb_build_object(
        'has_follow_up_notes',
        (v_record.follow_up_notes IS NOT NULL AND length(trim(v_record.follow_up_notes)) > 0)
      );
    WHEN 'read_and_sign' THEN
      v_employee_id := v_record.created_by;
      v_location_id := v_record.location_id;
      v_entry_title := COALESCE(v_record.title, 'Read & Sign Document');
    WHEN 'catering_order' THEN
      v_employee_id := v_record.created_by;
      v_location_id := v_record.location_id;
      v_entry_title := 'Catering: ' || v_record.customer_name;
      v_metadata := jsonb_build_object('pickup_date', v_record.pickup_date, 'order_number', v_record.order_number);
    ELSE
      v_entry_title := v_entry_type;
  END CASE;

  SELECT full_name INTO v_employee_name FROM profiles WHERE id = v_employee_id;
  SELECT full_name INTO v_performer_name FROM profiles WHERE id = COALESCE(auth.uid(), v_employee_id);

  INSERT INTO logbook_audit (entry_id, entry_type, action, employee_id, employee_name, location_id, reason, performed_by, performed_by_name, entry_title, metadata)
  VALUES (
    v_record.id,
    v_entry_type,
    v_action,
    v_employee_id,
    v_employee_name,
    v_location_id,
    v_reason,
    COALESCE(auth.uid(), v_employee_id),
    v_performer_name,
    v_entry_title,
    v_metadata
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;