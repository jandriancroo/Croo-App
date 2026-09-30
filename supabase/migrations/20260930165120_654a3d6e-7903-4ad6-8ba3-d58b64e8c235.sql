CREATE TABLE public.checklist_photo_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  photo_hash text NOT NULL,
  submission_id uuid,
  item_id uuid,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.checklist_photo_fingerprints TO authenticated;
GRANT ALL ON public.checklist_photo_fingerprints TO service_role;
ALTER TABLE public.checklist_photo_fingerprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Location users can view photo fingerprints" ON public.checklist_photo_fingerprints
  FOR SELECT TO authenticated USING (public.has_location_access(auth.uid(), location_id));
CREATE INDEX idx_cpf_loc_hash ON public.checklist_photo_fingerprints (location_id, photo_hash, created_at DESC);

-- Returns true if the photo is new (and records it); false if the same photo
-- was already used at this store in the last 7 days on a different submission.
CREATE OR REPLACE FUNCTION public.claim_checklist_photo(_location_id uuid, _photo_hash text, _submission_id uuid, _item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_location_access(auth.uid(), _location_id) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _photo_hash IS NULL OR length(_photo_hash) <> 64 THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.checklist_photo_fingerprints
    WHERE location_id = _location_id AND photo_hash = _photo_hash
      AND created_at > now() - interval '7 days'
      AND submission_id IS DISTINCT FROM _submission_id
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO public.checklist_photo_fingerprints (location_id, photo_hash, submission_id, item_id, user_id)
  VALUES (_location_id, _photo_hash, _submission_id, _item_id, auth.uid());
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_checklist_photo(uuid, text, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_checklist_photo(uuid, text, uuid, uuid) TO authenticated;