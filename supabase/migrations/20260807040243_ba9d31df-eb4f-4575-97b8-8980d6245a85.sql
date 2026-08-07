CREATE OR REPLACE FUNCTION public.revoke_sessions_on_deactivate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.is_active IS FALSE AND (OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
    BEGIN
      DELETE FROM auth.refresh_tokens WHERE user_id::uuid = NEW.id;
      DELETE FROM auth.sessions WHERE user_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'revoke_sessions_on_deactivate failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_sessions_on_deactivate ON public.profiles;
CREATE TRIGGER trg_revoke_sessions_on_deactivate
AFTER UPDATE OF is_active ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.revoke_sessions_on_deactivate();

REVOKE ALL ON FUNCTION public.revoke_sessions_on_deactivate() FROM PUBLIC, anon, authenticated;