CREATE TABLE public.system_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL,
 body text NOT NULL DEFAULT '',
 kind text NOT NULL DEFAULT 'system' CHECK (kind IN ('theme','feature','system')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
 audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','super_admin')),
 action_kind text NOT NULL DEFAULT 'none' CHECK (action_kind IN ('none','theme','link')),
 action_label text NOT NULL DEFAULT 'Got it',
 action_value text,
 video_url text,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 CONSTRAINT system_alert_title_length CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
 CONSTRAINT system_alert_body_length CHECK (char_length(body) <= 4000),
 CONSTRAINT system_alert_action_valid CHECK (action_kind = 'none' OR (action_value IS NOT NULL AND char_length(trim(action_value)) > 0)),
 CONSTRAINT system_alert_theme_valid CHECK (action_kind <> 'theme' OR action_value IN ('default','oled','earth','beach','cupcake','spookified')),
 CONSTRAINT system_alert_link_valid CHECK (action_kind <> 'link' OR action_value ~ '^https://' OR action_value ~ '^/[^/]'),
 CONSTRAINT system_alert_video_valid CHECK (video_url IS NULL OR video_url ~ '^https://')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_alerts_read ON public.system_alerts FOR SELECT TO authenticated USING (public.has_role_or_higher(auth.uid(), 'super_admin') OR (status = 'published' AND audience = 'all'));
CREATE POLICY system_alerts_create ON public.system_alerts FOR INSERT TO authenticated WITH CHECK (public.has_role_or_higher(auth.uid(), 'super_admin') AND created_by = auth.uid());
CREATE POLICY system_alerts_edit ON public.system_alerts FOR UPDATE TO authenticated USING (public.has_role_or_higher(auth.uid(), 'super_admin')) WITH CHECK (public.has_role_or_higher(auth.uid(), 'super_admin'));
CREATE POLICY system_alerts_delete ON public.system_alerts FOR DELETE TO authenticated USING (public.has_role_or_higher(auth.uid(), 'super_admin') AND status <> 'published');
CREATE INDEX system_alerts_delivery_idx ON public.system_alerts (published_at DESC) WHERE status = 'published';
CREATE TABLE public.system_alert_receipts (
 alert_id uuid NOT NULL REFERENCES public.system_alerts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL DEFAULT auth.uid(),
 seen_at timestamptz NOT NULL DEFAULT now(),
 outcome text NOT NULL DEFAULT 'dismissed' CHECK (outcome IN ('dismissed','action')),
 PRIMARY KEY (alert_id, user_id)
);
GRANT SELECT, INSERT ON public.system_alert_receipts TO authenticated;
GRANT ALL ON public.system_alert_receipts TO service_role;
ALTER TABLE public.system_alert_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_alert_receipts_read ON public.system_alert_receipts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY system_alert_receipts_create ON public.system_alert_receipts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.system_alerts a WHERE a.id = alert_id AND a.status = 'published' AND (a.audience = 'all' OR public.has_role_or_higher(auth.uid(), 'super_admin'))));
CREATE OR REPLACE FUNCTION public.get_next_system_alert() RETURNS SETOF public.system_alerts LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
 SELECT a.* FROM public.system_alerts a WHERE auth.uid() IS NOT NULL AND a.status = 'published' AND (a.audience = 'all' OR public.has_role_or_higher(auth.uid(), 'super_admin')) AND NOT EXISTS (SELECT 1 FROM public.system_alert_receipts r WHERE r.alert_id = a.id AND r.user_id = auth.uid()) ORDER BY a.published_at DESC, a.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_next_system_alert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_system_alert() TO authenticated, service_role;