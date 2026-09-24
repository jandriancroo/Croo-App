CREATE POLICY "Authorized staff can delete hiring conversations"
ON public.hiring_conversations
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.job_applications ja
    WHERE ja.id = hiring_conversations.application_id
      AND (
        public.is_super_admin(auth.uid())
        OR public.is_org_admin(auth.uid(), ja.organization_id)
        OR (
          public.has_location_access(auth.uid(), ja.location_id)
          AND public.has_role_or_higher(auth.uid(), 'manager'::text)
        )
      )
  )
);