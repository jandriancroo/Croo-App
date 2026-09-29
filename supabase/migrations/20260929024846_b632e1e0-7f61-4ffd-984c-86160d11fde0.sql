CREATE OR REPLACE FUNCTION public.sync_toast_mapping_to_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.toast_shifts
    SET croo_user_id = NULL,
        croo_scheduled_shift_id = NULL,
        updated_at = now()
    WHERE location_id = OLD.location_id
      AND toast_user_id = OLD.toast_user_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (OLD.location_id, OLD.toast_user_id) IS DISTINCT FROM (NEW.location_id, NEW.toast_user_id) THEN
    UPDATE public.toast_shifts
    SET croo_user_id = NULL,
        croo_scheduled_shift_id = NULL,
        updated_at = now()
    WHERE location_id = OLD.location_id
      AND toast_user_id = OLD.toast_user_id;
  END IF;

  UPDATE public.toast_shifts
  SET croo_user_id = NEW.croo_user_id,
      croo_scheduled_shift_id = CASE
        WHEN NEW.croo_user_id IS NULL THEN NULL
        ELSE croo_scheduled_shift_id
      END,
      updated_at = now()
  WHERE location_id = NEW.location_id
    AND toast_user_id = NEW.toast_user_id
    AND croo_user_id IS DISTINCT FROM NEW.croo_user_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_toast_mapping_to_shifts() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_toast_mapping_to_shifts_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.toast_employee_mappings
FOR EACH ROW
EXECUTE FUNCTION public.sync_toast_mapping_to_shifts();

UPDATE public.toast_shifts AS s
SET croo_user_id = m.croo_user_id,
    croo_scheduled_shift_id = CASE
      WHEN m.croo_user_id IS NULL THEN NULL
      ELSE s.croo_scheduled_shift_id
    END,
    updated_at = now()
FROM public.toast_employee_mappings AS m
WHERE s.location_id = m.location_id
  AND s.toast_user_id = m.toast_user_id
  AND s.croo_user_id IS DISTINCT FROM m.croo_user_id;