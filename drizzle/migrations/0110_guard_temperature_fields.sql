-- Andy piggyback (Nov 24 2026 1:18 PM PT). Precondition: server-side read writes checklist_responses with service role (auth.uid() NULL).
CREATE OR REPLACE FUNCTION public._guard_temperature_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- service role / cron (server-side read) and managers pass
  IF v_uid IS NULL OR public.has_role_or_higher(v_uid, 'shift_manager_in_training') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.extracted_temperature IS NOT NULL OR NEW.temperature_valid IS NOT NULL
       OR NEW.temperature_ai_original IS NOT NULL OR NEW.temperature_ai_latest IS NOT NULL THEN
      RAISE EXCEPTION 'temp_server_only: temperature is set by the server' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- AI/audit columns: server only
  IF NEW.temperature_ai_original IS DISTINCT FROM OLD.temperature_ai_original
     OR NEW.temperature_ai_latest IS DISTINCT FROM OLD.temperature_ai_latest
     OR NEW.temperature_scan_count IS DISTINCT FROM OLD.temperature_scan_count
     OR NEW.temperature_last_scan_at IS DISTINCT FROM OLD.temperature_last_scan_at
     OR NEW.temperature_validated_at IS DISTINCT FROM OLD.temperature_validated_at THEN
    RAISE EXCEPTION 'temp_server_only: temperature is set by the server' USING ERRCODE = '42501';
  END IF;
  -- crew may change the reading only as a stamped, visible edit
  IF (NEW.extracted_temperature IS DISTINCT FROM OLD.extracted_temperature
      OR NEW.temperature_valid IS DISTINCT FROM OLD.temperature_valid)
     AND NEW.temperature_edited_at IS NOT DISTINCT FROM OLD.temperature_edited_at THEN
    RAISE EXCEPTION 'temp_server_only: temperature is set by the server' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._guard_temperature_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_temperature_fields ON public.checklist_responses;
CREATE TRIGGER trg_guard_temperature_fields
  BEFORE INSERT OR UPDATE ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION public._guard_temperature_fields();

-- Rollback:
-- DROP TRIGGER IF EXISTS trg_guard_temperature_fields ON public.checklist_responses; DROP FUNCTION IF EXISTS public._guard_temperature_fields();