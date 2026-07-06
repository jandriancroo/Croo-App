-- Fix Croo Feed audience scoping and database-triggered push delivery

-- 1) Allow the explicit managers audience value used by feed RLS/helpers.
ALTER TABLE public.announcement_channels
  DROP CONSTRAINT IF EXISTS announcement_channels_audience_type_check;

ALTER TABLE public.announcement_channels
  ADD CONSTRAINT announcement_channels_audience_type_check
  CHECK (audience_type IN ('everyone', 'managers', 'role', 'position', 'custom'));

-- 2) Seed usable audience channels per location. Existing null-channel posts remain All.
INSERT INTO public.announcement_channels (
  brand_id, location_id, name, slug, description, color, icon, audience_type, audience_config, sort_order, is_active
)
SELECT
  l.brand_id,
  l.id,
  'All',
  'all',
  'Everyone at this location',
  '#3B82F6',
  'megaphone',
  'everyone',
  '{}'::jsonb,
  0,
  true
FROM public.locations l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.announcement_channels c
  WHERE c.location_id = l.id AND c.slug = 'all'
);

INSERT INTO public.announcement_channels (
  brand_id, location_id, name, slug, description, color, icon, audience_type, audience_config, sort_order, is_active
)
SELECT
  l.brand_id,
  l.id,
  'Managers',
  'managers',
  'Shift managers and above',
  '#F59E0B',
  'shield',
  'managers',
  jsonb_build_object('min_role', 'shift_manager'),
  10,
  true
FROM public.locations l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.announcement_channels c
  WHERE c.location_id = l.id AND c.slug = 'managers'
);

-- 3) Audience qualification: null channel = All; managers = shift_manager and above.
CREATE OR REPLACE FUNCTION public.user_qualifies_for_channel_audience(
  _user_id uuid,
  _channel_id uuid,
  _location_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN public.has_role_or_higher(_user_id, 'admin') THEN true
    WHEN _channel_id IS NULL THEN
      EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.location_id = _location_id AND ul.user_id = _user_id
      )
    ELSE
      EXISTS (
        SELECT 1
        FROM public.announcement_channels c
        LEFT JOIN public.locations l ON l.id = _location_id
        WHERE c.id = _channel_id
          AND (
            c.location_id = _location_id
            OR (c.location_id IS NULL AND c.brand_id IS NOT NULL AND c.brand_id = l.brand_id)
          )
          AND EXISTS (
            SELECT 1 FROM public.user_locations ul
            WHERE ul.location_id = _location_id AND ul.user_id = _user_id
          )
          AND (
            c.audience_type = 'everyone'
            OR (c.audience_type = 'managers' AND public.has_role_or_higher(_user_id, 'shift_manager'))
          )
      )
  END
$$;

GRANT EXECUTE ON FUNCTION public.user_qualifies_for_channel_audience(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.feed_channel_audience_recipients(
  _location_id uuid,
  _channel_id uuid
) RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ul.user_id
  FROM public.user_locations ul
  WHERE ul.location_id = _location_id
    AND public.user_qualifies_for_channel_audience(ul.user_id, _channel_id, _location_id)
$$;

GRANT EXECUTE ON FUNCTION public.feed_channel_audience_recipients(uuid, uuid) TO authenticated, service_role;

-- 4) Tighten post visibility: location posts must pass location membership + audience.
DROP POLICY IF EXISTS "Posts readable by audience members" ON public.announcement_posts;
DROP POLICY IF EXISTS "Posts readable by brand/location members" ON public.announcement_posts;

CREATE POLICY "Posts readable by audience members"
ON public.announcement_posts
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.has_role_or_higher(auth.uid(), 'admin')
    OR (
      location_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_locations ul
        WHERE ul.location_id = announcement_posts.location_id
          AND ul.user_id = auth.uid()
      )
      AND public.user_qualifies_for_channel_audience(auth.uid(), channel_id, location_id)
    )
    OR (
      location_id IS NULL
      AND brand_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.brand_members bm
        WHERE bm.brand_id = announcement_posts.brand_id
          AND bm.user_id = auth.uid()
      )
    )
  )
);

-- 5) Tighten creation: every location post needs membership/admin, and non-All audiences require shift manager+.
DROP POLICY IF EXISTS "Location members create feed posts" ON public.announcement_posts;
DROP POLICY IF EXISTS "Managers+ create posts" ON public.announcement_posts;

CREATE POLICY "Location members create feed posts"
ON public.announcement_posts
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND location_id IS NOT NULL
  AND (
    public.has_role_or_higher(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.location_id = announcement_posts.location_id
        AND ul.user_id = auth.uid()
    )
  )
  AND (
    channel_id IS NULL
    OR public.user_qualifies_for_channel_audience(auth.uid(), channel_id, location_id)
  )
  AND (
    public.has_role_or_higher(auth.uid(), 'manager')
    OR (
      is_announcement = false
      AND pinned = false
      AND (
        channel_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.announcement_channels c
          WHERE c.id = announcement_posts.channel_id
            AND c.audience_type = 'everyone'
        )
        OR public.has_role_or_higher(auth.uid(), 'shift_manager')
      )
    )
  )
);

-- 6) Recreate trigger functions with location_id passed to the push function and a longer timeout.
CREATE OR REPLACE FUNCTION public.notify_feed_post_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_key text;
  sender_name text;
  recipients uuid[];
  title_text text;
  body_text text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  IF supabase_url IS NULL THEN
    SELECT decrypted_secret INTO supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  IF service_key IS NULL THEN
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE LOG 'notify_feed_post_push: missing credentials';
    RETURN NEW;
  END IF;

  SELECT ARRAY(
    SELECT user_id FROM public.feed_channel_audience_recipients(NEW.location_id, NEW.channel_id)
    WHERE user_id <> NEW.author_id
  ) INTO recipients;

  IF recipients IS NULL OR array_length(recipients, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(nickname, ''), NULLIF(full_name, ''), 'Team')
    INTO sender_name
  FROM public.profiles WHERE id = NEW.author_id;
  sender_name := COALESCE(sender_name, 'Team');

  title_text := CASE WHEN NEW.is_announcement THEN sender_name ELSE sender_name END;
  body_text := LEFT(COALESCE(NULLIF(NEW.body, ''), 'Shared a post'), 140);

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(recipients),
      'sender_id', NEW.author_id,
      'location_id', NEW.location_id,
      'title', title_text,
      'body', body_text,
      'notification_type', CASE WHEN NEW.is_announcement THEN 'announcements' ELSE 'chat_messages' END,
      'data', jsonb_build_object(
        'post_id', NEW.id,
        'location_id', NEW.location_id,
        'channel_id', NEW.channel_id,
        'type', CASE WHEN NEW.is_announcement THEN 'announcement' ELSE 'feed_post' END
      )
    ),
    timeout_milliseconds := 25000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_feed_post_push failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_feed_comment_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_key text;
  sender_name text;
  post_row RECORD;
  recipients uuid[];
  body_text text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  IF supabase_url IS NULL THEN
    SELECT decrypted_secret INTO supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  IF service_key IS NULL THEN
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE LOG 'notify_feed_comment_push: missing credentials';
    RETURN NEW;
  END IF;

  SELECT id, author_id, location_id, channel_id, is_announcement
    INTO post_row
  FROM public.announcement_posts WHERE id = NEW.post_id;

  IF post_row IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT uid FROM (
      SELECT user_id AS uid FROM public.feed_channel_audience_recipients(post_row.location_id, post_row.channel_id)
      UNION
      SELECT post_row.author_id
    ) s
    WHERE uid IS NOT NULL AND uid <> NEW.author_id
  ) INTO recipients;

  IF recipients IS NULL OR array_length(recipients, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(nickname, ''), NULLIF(full_name, ''), 'Team')
    INTO sender_name
  FROM public.profiles WHERE id = NEW.author_id;
  sender_name := COALESCE(sender_name, 'Team');

  body_text := LEFT(COALESCE(NULLIF(NEW.body, ''), 'Commented on a post'), 140);

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(recipients),
      'sender_id', NEW.author_id,
      'location_id', post_row.location_id,
      'title', sender_name || ' commented',
      'body', body_text,
      'notification_type', 'chat_messages',
      'data', jsonb_build_object(
        'post_id', post_row.id,
        'comment_id', NEW.id,
        'location_id', post_row.location_id,
        'channel_id', post_row.channel_id,
        'type', 'feed_comment'
      )
    ),
    timeout_milliseconds := 25000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_feed_comment_push failed: %', SQLERRM;
  RETURN NEW;
END;
$$;