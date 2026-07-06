GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_reads TO authenticated;
GRANT ALL ON public.announcement_reads TO service_role;

DROP POLICY IF EXISTS "Users can view announcement reads" ON public.announcement_reads;
DROP POLICY IF EXISTS "Users can mark announcements as opened" ON public.announcement_reads;
DROP POLICY IF EXISTS "Users can update own announcement reads" ON public.announcement_reads;
DROP POLICY IF EXISTS "Users can view feed post announcement reads" ON public.announcement_reads;
DROP POLICY IF EXISTS "Users can mark feed posts as read" ON public.announcement_reads;

CREATE POLICY "Users can view announcement reads"
ON public.announcement_reads
FOR SELECT
TO authenticated
USING (
  (
    chat_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.chat_members cm
      WHERE cm.chat_id = announcement_reads.chat_id
        AND cm.user_id = auth.uid()
    )
  )
  OR
  (
    post_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.announcement_posts ap
      WHERE ap.id = announcement_reads.post_id
        AND ap.deleted_at IS NULL
        AND (
          public.has_role_or_higher(auth.uid(), 'admin')
          OR (
            ap.location_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.user_locations ul
              WHERE ul.location_id = ap.location_id
                AND ul.user_id = auth.uid()
            )
            AND public.user_qualifies_for_channel_audience(auth.uid(), ap.channel_id, ap.location_id)
          )
          OR (
            ap.location_id IS NULL
            AND ap.brand_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.brand_members bm
              WHERE bm.brand_id = ap.brand_id
                AND bm.user_id = auth.uid()
            )
          )
        )
    )
  )
);

CREATE POLICY "Users can mark announcements as opened"
ON public.announcement_reads
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    (
      chat_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.chat_members cm
        WHERE cm.chat_id = announcement_reads.chat_id
          AND cm.user_id = auth.uid()
      )
    )
    OR
    (
      post_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.announcement_posts ap
        WHERE ap.id = announcement_reads.post_id
          AND ap.deleted_at IS NULL
          AND (
            public.has_role_or_higher(auth.uid(), 'admin')
            OR (
              ap.location_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM public.user_locations ul
                WHERE ul.location_id = ap.location_id
                  AND ul.user_id = auth.uid()
              )
              AND public.user_qualifies_for_channel_audience(auth.uid(), ap.channel_id, ap.location_id)
            )
            OR (
              ap.location_id IS NULL
              AND ap.brand_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM public.brand_members bm
                WHERE bm.brand_id = ap.brand_id
                  AND bm.user_id = auth.uid()
              )
            )
          )
      )
    )
  )
);

CREATE POLICY "Users can update own announcement reads"
ON public.announcement_reads
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP INDEX IF EXISTS public.idx_announcement_reads_post_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_reads_post_user
ON public.announcement_reads(post_id, user_id)
WHERE post_id IS NOT NULL AND chat_id IS NULL;