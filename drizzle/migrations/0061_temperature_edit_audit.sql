ALTER TABLE public.checklist_responses
  ADD COLUMN IF NOT EXISTS temperature_edited_by uuid,
  ADD COLUMN IF NOT EXISTS temperature_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS temperature_previous numeric;

COMMENT ON COLUMN public.checklist_responses.temperature_edited_by IS 'Who last overwrote the temperature by hand (set server-side from auth.uid()).';
COMMENT ON COLUMN public.checklist_responses.temperature_previous IS 'Reading that the last hand edit replaced (null = there was no reading).';

CREATE OR REPLACE FUNCTION public._stamp_temperature_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.temperature_edited_at IS DISTINCT FROM OLD.temperature_edited_at AND NEW.temperature_edited_at IS NOT NULL THEN
    NEW.temperature_previous := OLD.extracted_temperature;
    NEW.temperature_edited_by := COALESCE(auth.uid(), NEW.temperature_edited_by);
    NEW.temperature_edited_at := now();
  ELSE
    NEW.temperature_edited_by := OLD.temperature_edited_by;
    NEW.temperature_edited_at := OLD.temperature_edited_at;
    NEW.temperature_previous := OLD.temperature_previous;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._stamp_temperature_edit_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.temperature_edited_at IS NOT NULL THEN
    NEW.temperature_previous := NULL;
    NEW.temperature_edited_by := COALESCE(auth.uid(), NEW.temperature_edited_by);
    NEW.temperature_edited_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_temperature_edit ON public.checklist_responses;
CREATE TRIGGER trg_stamp_temperature_edit BEFORE UPDATE ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION public._stamp_temperature_edit();
DROP TRIGGER IF EXISTS trg_stamp_temperature_edit_ins ON public.checklist_responses;
CREATE TRIGGER trg_stamp_temperature_edit_ins BEFORE INSERT ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION public._stamp_temperature_edit_insert();