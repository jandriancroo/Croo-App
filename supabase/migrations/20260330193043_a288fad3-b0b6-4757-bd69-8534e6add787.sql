-- Trigger: auto-queue backfill_sales when a new qubeyond integration is inserted
CREATE OR REPLACE FUNCTION public.auto_queue_sales_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire for qubeyond integrations that are active
  IF NEW.integration_type = 'qubeyond' AND NEW.is_active = true THEN
    INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
    VALUES ('backfill_sales', NEW.location_id, (CURRENT_DATE - INTERVAL '1 day')::date, 'pending');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_queue_sales_backfill
  AFTER INSERT ON public.location_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_queue_sales_backfill();