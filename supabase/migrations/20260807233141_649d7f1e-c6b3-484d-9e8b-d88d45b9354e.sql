ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS bank_verification_enabled boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "bank_verification_read" ON storage.objects;
DROP POLICY IF EXISTS "bank_verification_insert" ON storage.objects;
DROP POLICY IF EXISTS "bank_verification_delete" ON storage.objects;

CREATE POLICY "bank_verification_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'bank-verification'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (split_part(name, '/', 1))::uuid IN (SELECT public.get_user_location_ids(auth.uid()))
  )
);

CREATE POLICY "bank_verification_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'bank-verification'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (split_part(name, '/', 1))::uuid IN (SELECT public.get_user_location_ids(auth.uid()))
  )
);

CREATE POLICY "bank_verification_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'bank-verification'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR (split_part(name, '/', 1))::uuid IN (SELECT public.get_user_location_ids(auth.uid()))
  )
);