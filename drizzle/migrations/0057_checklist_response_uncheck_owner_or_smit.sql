DROP POLICY IF EXISTS "Users can delete responses at their locations" ON public.checklist_responses;
CREATE POLICY "Owner or SMIT+ can delete responses at their locations"
ON public.checklist_responses FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.checklist_submissions cs
          WHERE cs.id = checklist_responses.submission_id
            AND public.has_location_access(auth.uid(), cs.location_id))
  AND (checklist_responses.completed_by = auth.uid()
       OR public.has_role_or_higher(auth.uid(), 'shift_manager_in_training'))
);

DROP POLICY IF EXISTS "Users can update responses at their locations" ON public.checklist_responses;
CREATE POLICY "Users can update responses at their locations"
ON public.checklist_responses FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.checklist_submissions cs
          WHERE cs.id = checklist_responses.submission_id
            AND public.has_location_access(auth.uid(), cs.location_id))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.checklist_submissions cs
          WHERE cs.id = checklist_responses.submission_id
            AND public.has_location_access(auth.uid(), cs.location_id))
  AND (
    public.has_role_or_higher(auth.uid(), 'shift_manager_in_training')
    OR (
      checklist_responses.completed_by = auth.uid()
      AND (
        NULLIF(btrim(COALESCE(checklist_responses.response_text, '')), '') IS NOT NULL
        OR NULLIF(btrim(COALESCE(checklist_responses.response_image_url, '')), '') IS NOT NULL
        OR (jsonb_typeof(checklist_responses.response_image_urls) = 'array'
            AND jsonb_array_length(checklist_responses.response_image_urls) > 0)
      )
    )
  )
);