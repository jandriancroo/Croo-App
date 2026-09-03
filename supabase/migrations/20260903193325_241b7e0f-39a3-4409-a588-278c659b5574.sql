-- 1) New nullable columns
ALTER TABLE public.employee_writeups
  ADD COLUMN IF NOT EXISTS family_id uuid,
  ADD COLUMN IF NOT EXISTS transcript_text text,
  ADD COLUMN IF NOT EXISTS notes_bullets jsonb,
  ADD COLUMN IF NOT EXISTS consent_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS recording_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS stt_model_used text;

-- 2) Backfill: every existing row is a trail of one
UPDATE public.employee_writeups SET family_id = id WHERE family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_writeups_family_id ON public.employee_writeups (family_id);
CREATE INDEX IF NOT EXISTS idx_employee_writeups_employee_created ON public.employee_writeups (employee_id, created_at DESC);

-- 3) Recorded sessions can rely on notes_bullets instead of typed notes
ALTER TABLE public.employee_writeups ALTER COLUMN issue_description DROP NOT NULL;
ALTER TABLE public.employee_writeups ALTER COLUMN next_steps DROP NOT NULL;

-- 4) Transcript is manager-tier only: remove column-level read for app roles
REVOKE SELECT (transcript_text) ON public.employee_writeups FROM authenticated;
REVOKE SELECT (transcript_text) ON public.employee_writeups FROM anon;
GRANT ALL ON public.employee_writeups TO service_role;

-- 5) Manager-tier read path for the transcript
CREATE OR REPLACE FUNCTION public.get_corrective_action_transcript(_writeup_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _loc uuid;
  _txt text;
BEGIN
  SELECT location_id, transcript_text INTO _loc, _txt
  FROM public.employee_writeups WHERE id = _writeup_id;

  IF _loc IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_role_or_higher(auth.uid(), 'manager') THEN
    RAISE EXCEPTION 'Not authorized to read corrective action transcripts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = _loc
  ) AND NOT public.has_role_or_higher(auth.uid(), 'org_admin') THEN
    RAISE EXCEPTION 'Not authorized for this location';
  END IF;

  RETURN _txt;
END;
$$;

REVOKE ALL ON FUNCTION public.get_corrective_action_transcript(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_corrective_action_transcript(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_corrective_action_transcript(uuid) TO service_role;