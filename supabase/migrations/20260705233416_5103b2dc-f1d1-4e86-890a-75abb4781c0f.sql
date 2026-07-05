
-- 1. Helper: does a user qualify for a channel's audience?
CREATE OR REPLACE FUNCTION public.user_qualifies_for_channel_audience(
  _user_id uuid,
  _channel_id uuid,
  _location_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    -- null channel = everyone: any location member (or admin) qualifies
    WHEN _channel_id IS NULL THEN
      public.has_role_or_higher(_user_id, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.location_id = _location_id AND ul.user_id = _user_id
      )
    ELSE
      EXISTS (
        SELECT 1
        FROM public.announcement_channels c
        WHERE c.id = _channel_id
          AND (
            public.has_role_or_higher(_user_id, 'admin')
            OR c.audience_type = 'everyone'
            OR (c.audience_type = 'managers' AND public.has_role_or_higher(_user_id, 'manager'))
          )
      )
  END
$$;

GRANT EXECUTE ON FUNCTION public.user_qualifies_for_channel_audience(uuid, uuid, uuid) TO authenticated, service_role;

-- 2. Helper: return notification recipients for a post's channel audience
CREATE OR REPLACE FUNCTION public.feed_channel_audience_recipients(
  _location_id uuid,
  _channel_id uuid
) RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ul.user_id
  FROM public.user_locations ul
  WHERE ul.location_id = _location_id
    AND (
      _channel_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.announcement_channels c
        WHERE c.id = _channel_id
          AND (
            c.audience_type = 'everyone'
            OR (
              c.audience_type = 'managers'
              AND public.has_role_or_higher(ul.user_id, 'manager')
            )
          )
      )
    )
$$;

GRANT EXECUTE ON FUNCTION public.feed_channel_audience_recipients(uuid, uuid) TO authenticated, service_role;

-- 3. Tighten SELECT policy on announcement_posts to enforce channel audience
DROP POLICY IF EXISTS "Posts readable by brand/location members" ON public.announcement_posts;

CREATE POLICY "Posts readable by audience members"
ON public.announcement_posts
FOR SELECT
USING (
  deleted_at IS NULL
  AND (
    public.has_role_or_higher(auth.uid(), 'admin')
    OR (
      brand_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.brand_members bm
        WHERE bm.brand_id = announcement_posts.brand_id AND bm.user_id = auth.uid()
      )
    )
    OR (
      location_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.location_id = announcement_posts.location_id AND ul.user_id = auth.uid()
      )
      AND public.user_qualifies_for_channel_audience(auth.uid(), channel_id, location_id)
    )
  )
);

-- 4. Tighten INSERT policy: non-everyone channels require manager+
DROP POLICY IF EXISTS "Location members create feed posts" ON public.announcement_posts;

CREATE POLICY "Location members create feed posts"
ON public.announcement_posts
FOR INSERT
WITH CHECK (
  author_id = auth.uid()
  AND (
    public.has_role_or_higher(auth.uid(), 'manager')
    OR (
      is_announcement = false
      AND pinned = false
      AND location_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.location_id = announcement_posts.location_id AND ul.user_id = auth.uid()
      )
      AND (
        channel_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.announcement_channels c
          WHERE c.id = channel_id AND c.audience_type = 'everyone'
        )
      )
    )
  )
);
