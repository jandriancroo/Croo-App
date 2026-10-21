ALTER TABLE public.system_alerts ALTER COLUMN audience SET DEFAULT 'super_admin';
ALTER TABLE public.system_alerts ADD CONSTRAINT system_alert_link_safe CHECK (action_kind <> 'link' OR (action_value NOT LIKE '%' || chr(92) || '%' AND (action_value ~ '^https://' OR action_value ~ '^/[^/]')));
CREATE OR REPLACE FUNCTION public.guard_system_alert_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  IF OLD.status <> 'draft' AND (NEW.title, NEW.body, NEW.kind, NEW.audience, NEW.action_kind, NEW.action_label, NEW.action_value, NEW.video_url) IS DISTINCT FROM (OLD.title, OLD.body, OLD.kind, OLD.audience, OLD.action_kind, OLD.action_label, OLD.action_value, OLD.video_url) THEN
   RAISE EXCEPTION 'Published alerts cannot be edited. Copy to a new draft.';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN RAISE EXCEPTION 'Retired alerts cannot be republished. Copy to a new draft.'; END IF;
  IF OLD.status = 'published' AND NEW.status = 'draft' THEN RAISE EXCEPTION 'Published alerts cannot return to draft.'; END IF;
 END IF;
 IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN NEW.published_at := now(); END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_system_alert_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_system_alert_update BEFORE INSERT OR UPDATE ON public.system_alerts FOR EACH ROW EXECUTE FUNCTION public.guard_system_alert_update();