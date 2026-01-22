-- Ensure read tracking works for hiring conversations

ALTER TABLE public.hiring_conversations ENABLE ROW LEVEL SECURITY;

-- Allow managers/admins (and above) with access to the application's location to update last_read_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hiring_conversations'
      AND policyname = 'Staff can update hiring conversation read state'
  ) THEN
    CREATE POLICY "Staff can update hiring conversation read state"
    ON public.hiring_conversations
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1
        FROM public.job_applications ja
        WHERE ja.id = hiring_conversations.application_id
          AND public.has_location_access(auth.uid(), ja.location_id)
          AND public.has_role_or_higher(auth.uid(), 'manager')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.job_applications ja
        WHERE ja.id = hiring_conversations.application_id
          AND public.has_location_access(auth.uid(), ja.location_id)
          AND public.has_role_or_higher(auth.uid(), 'manager')
      )
    );
  END IF;
END $$;