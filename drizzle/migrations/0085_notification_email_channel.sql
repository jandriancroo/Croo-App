CREATE TABLE public.user_notification_settings_email_backup_20261101 (id uuid PRIMARY KEY, email_enabled boolean);
GRANT ALL ON public.user_notification_settings_email_backup_20261101 TO service_role;
ALTER TABLE public.user_notification_settings_email_backup_20261101 ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_only ON public.user_notification_settings_email_backup_20261101 FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION public.queue_notification_email(_user_id uuid, _location_id uuid, _type text, _ref text, _email text, _subject text, _html text, _chat_id text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_id uuid;
BEGIN
 IF _type !~ '^[a-z_]{1,64}$' OR length(_ref) > 500 OR length(_subject) > 300 OR _email IS NULL OR _html IS NULL THEN RAISE EXCEPTION 'Invalid notification email'; END IF;
 IF _chat_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('notify-chat:' || _chat_id || ':' || _user_id::text, 0));
   IF EXISTS (SELECT 1 FROM public.email_queue WHERE source = 'notify_chat_messages' AND metadata->>'chat_id' = _chat_id AND metadata->>'user_id' = _user_id::text AND created_at > now() - interval '30 minutes') THEN RETURN false; END IF;
 END IF;
 INSERT INTO public.email_queue(to_addresses,subject,html,source,email_type,location_id,dedup_key,metadata)
 VALUES (ARRAY[_email],_subject,_html,'notify_' || _type,'notification',_location_id,_type || ':' || _ref || ':' || _user_id::text,jsonb_build_object('user_id',_user_id,'chat_id',_chat_id))
 ON CONFLICT DO NOTHING RETURNING id INTO inserted_id;
 RETURN inserted_id IS NOT NULL;
END; $$;
REVOKE ALL ON FUNCTION public.queue_notification_email(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_notification_email(uuid,uuid,text,text,text,text,text,text) TO service_role;