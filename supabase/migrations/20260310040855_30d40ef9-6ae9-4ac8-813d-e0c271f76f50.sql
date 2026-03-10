
-- Temporary audit log table for inventory count debugging (safe to drop after testing)
CREATE TABLE IF NOT EXISTS public.inventory_count_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL,
  table_name text NOT NULL,
  record_id text,
  count_id text,
  user_id uuid,
  details jsonb
);

-- No RLS needed - this is a write-only debug table
ALTER TABLE public.inventory_count_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins can read audit log" ON public.inventory_count_audit_log
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE POLICY "Authenticated users can insert audit log" ON public.inventory_count_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- Trigger function for inventory_counts
CREATE OR REPLACE FUNCTION public.log_inventory_count_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inventory_count_audit_log (operation, table_name, record_id, count_id, user_id, details)
    VALUES ('INSERT', 'inventory_counts', NEW.id::text, NEW.id::text, auth.uid(),
      jsonb_build_object('status', NEW.status, 'period_type', NEW.period_type, 'period_end_date', NEW.period_end_date, 'is_late_close', NEW.is_late_close, 'location_id', NEW.location_id));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO inventory_count_audit_log (operation, table_name, record_id, count_id, user_id, details)
    VALUES ('UPDATE', 'inventory_counts', NEW.id::text, NEW.id::text, auth.uid(),
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status, 'counted_at', NEW.counted_at, 'completed_at', NEW.completed_at, 'duration_seconds', NEW.duration_seconds));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO inventory_count_audit_log (operation, table_name, record_id, count_id, user_id, details)
    VALUES ('DELETE', 'inventory_counts', OLD.id::text, OLD.id::text, auth.uid(),
      jsonb_build_object('status', OLD.status, 'period_type', OLD.period_type, 'period_end_date', OLD.period_end_date));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_inventory_count_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.log_inventory_count_changes();

-- Trigger function for inventory_count_items
CREATE OR REPLACE FUNCTION public.log_inventory_count_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inventory_count_audit_log (operation, table_name, record_id, count_id, user_id, details)
    VALUES ('INSERT', 'inventory_count_items', NEW.id::text, NEW.count_id::text, auth.uid(),
      jsonb_build_object('item_id', NEW.item_id, 'quantity', NEW.quantity, 'entered_cases', NEW.entered_cases, 'entered_units', NEW.entered_units));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO inventory_count_audit_log (operation, table_name, record_id, count_id, user_id, details)
    VALUES ('UPDATE', 'inventory_count_items', NEW.id::text, NEW.count_id::text, auth.uid(),
      jsonb_build_object('item_id', NEW.item_id, 'old_qty', OLD.quantity, 'new_qty', NEW.quantity, 'entered_cases', NEW.entered_cases, 'entered_units', NEW.entered_units));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO inventory_count_audit_log (operation, table_name, record_id, count_id, user_id, details)
    VALUES ('DELETE', 'inventory_count_items', OLD.id::text, OLD.count_id::text, auth.uid(),
      jsonb_build_object('item_id', OLD.item_id, 'quantity', OLD.quantity));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_inventory_count_item_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_count_items
  FOR EACH ROW EXECUTE FUNCTION public.log_inventory_count_item_changes();
