
-- Rename and expand the audit table to cover ALL logbook entry types
ALTER TABLE public.employee_writeup_audit RENAME TO logbook_audit;

-- Add columns for universal logging
ALTER TABLE public.logbook_audit 
  ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'writeup',
  ADD COLUMN entry_title TEXT,
  ADD COLUMN metadata JSONB;

-- Rename writeup-specific column to be generic
ALTER TABLE public.logbook_audit RENAME COLUMN writeup_id TO entry_id;

-- Drop old writeup-only triggers
DROP TRIGGER IF EXISTS audit_writeup_insert ON public.employee_writeups;
DROP TRIGGER IF EXISTS audit_writeup_delete ON public.employee_writeups;
DROP FUNCTION IF EXISTS public.log_writeup_audit();

-- Create universal audit function
CREATE OR REPLACE FUNCTION public.log_logbook_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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

  v_entry_type := TG_ARGV[0]; -- passed as trigger argument

  -- Extract fields based on table
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
      v_entry_title := COALESCE(v_record.title, 'Logbook Entry');
      -- Get category name
      SELECT name INTO v_reason FROM logbook_categories WHERE id = v_record.category_id;
      v_metadata := jsonb_build_object('category', v_reason, 'entry_date', v_record.entry_date);
    WHEN 'performance_review' THEN
      v_employee_id := v_record.employee_id;
      v_location_id := v_record.location_id;
      v_entry_title := 'Performance Review';
      v_metadata := jsonb_build_object('overall_rating', v_record.overall_rating);
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
$$;

-- Attach triggers to ALL logbook-related tables

-- Employee Write-Ups
CREATE TRIGGER audit_writeup_insert
  AFTER INSERT ON public.employee_writeups
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('writeup');

CREATE TRIGGER audit_writeup_delete
  AFTER DELETE ON public.employee_writeups
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('writeup');

-- Logbook Entries (pass down, incidents, safe counts, drawer counts, etc.)
CREATE TRIGGER audit_logbook_entry_insert
  AFTER INSERT ON public.logbook_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('logbook_entry');

CREATE TRIGGER audit_logbook_entry_delete
  AFTER DELETE ON public.logbook_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('logbook_entry');

-- Performance Reviews
CREATE TRIGGER audit_perf_review_insert
  AFTER INSERT ON public.performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('performance_review');

CREATE TRIGGER audit_perf_review_delete
  AFTER DELETE ON public.performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('performance_review');

-- Read & Sign Documents
CREATE TRIGGER audit_read_sign_insert
  AFTER INSERT ON public.read_and_sign_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('read_and_sign');

CREATE TRIGGER audit_read_sign_delete
  AFTER DELETE ON public.read_and_sign_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('read_and_sign');

-- Catering Orders
CREATE TRIGGER audit_catering_insert
  AFTER INSERT ON public.catering_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('catering_order');

CREATE TRIGGER audit_catering_delete
  AFTER DELETE ON public.catering_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_logbook_audit('catering_order');

-- Update RLS policy name to match new table name
ALTER POLICY "Super admins can view writeup audit" ON public.logbook_audit
  RENAME TO "Super admins can view logbook audit";

-- Add index on entry_type for filtering
CREATE INDEX idx_logbook_audit_entry_type ON public.logbook_audit (entry_type);
