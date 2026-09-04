CREATE OR REPLACE FUNCTION public.get_corrective_action_transcript_admin(_writeup_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _loc uuid;
  _emp uuid;
  _txt text;
BEGIN
  SELECT location_id, employee_id, transcript_text INTO _loc, _emp, _txt
  FROM public.employee_writeups WHERE id = _writeup_id;

  IF _loc IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT public.has_role_or_higher(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized to read corrective action transcripts';
  END IF;

  IF _emp = auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to read your own corrective action transcript';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = _loc
  ) AND NOT public.has_role_or_higher(auth.uid(), 'org_admin') THEN
    RAISE EXCEPTION 'Not authorized for this location';
  END IF;

  RETURN _txt;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_corrective_action_transcript_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_corrective_action_transcript_admin(uuid) TO authenticated;