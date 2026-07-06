
-- Server-side push notification triggers for feed posts and comments.
-- Guarantees pushes fire even when posts are created outside the client (e.g. admin/SQL inserts).

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

  title_text := CASE WHEN NEW.is_announcement THEN '📢 ' || sender_name ELSE sender_name END;
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
      'title', title_text,
      'body', body_text,
      'notification_type', CASE WHEN NEW.is_announcement THEN 'announcements' ELSE 'chat_messages' END,
      'data', jsonb_build_object(
        'post_id', NEW.id,
        'location_id', NEW.location_id,
        'channel_id', NEW.channel_id,
        'type', CASE WHEN NEW.is_announcement THEN 'announcement' ELSE 'feed_post' END
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_feed_post_push failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_feed_post_push ON public.announcement_posts;
CREATE TRIGGER trg_notify_feed_post_push
AFTER INSERT ON public.announcement_posts
FOR EACH ROW EXECUTE FUNCTION public.notify_feed_post_push();


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
    RETURN NEW;
  END IF;

  SELECT id, author_id, location_id, channel_id, is_announcement
    INTO post_row
  FROM public.announcement_posts WHERE id = NEW.post_id;

  IF post_row IS NULL THEN
    RETURN NEW;
  END IF;

  -- Notify audience of the parent post's channel, plus the post author, excluding the commenter
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
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_feed_comment_push failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_feed_comment_push ON public.announcement_comments;
CREATE TRIGGER trg_notify_feed_comment_push
AFTER INSERT ON public.announcement_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_feed_comment_push();
