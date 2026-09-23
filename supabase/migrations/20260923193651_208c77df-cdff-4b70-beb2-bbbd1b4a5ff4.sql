UPDATE public.job_applications ja
SET location_id = s.loc_id
FROM (
  SELECT organization_id, (array_agg(id))[1] AS loc_id
  FROM public.locations WHERE location_type = 'standard'
  GROUP BY organization_id HAVING count(*) = 1
) s
WHERE ja.location_id IS NULL AND ja.organization_id = s.organization_id;

ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_location_required CHECK (location_id IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION public.validate_job_application_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'Please choose a location';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = NEW.location_id AND l.organization_id = NEW.organization_id AND l.location_type = 'standard'
  ) THEN
    RAISE EXCEPTION 'That location is not part of this organization';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_job_application_location
BEFORE INSERT OR UPDATE OF location_id, organization_id ON public.job_applications
FOR EACH ROW EXECUTE FUNCTION public.validate_job_application_location();