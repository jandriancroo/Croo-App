-- CrooHQ: chat_members location guard (Andy, 2026-10-08, approved by Jordan 9:20 PM PT via Ryan)
-- Blocks adding a member to a location-scoped chat unless they have access to that location.
CREATE OR REPLACE FUNCTION public.enforce_chat_member_location_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _loc uuid;
BEGIN
  SELECT c.location_id INTO _loc FROM public.chats c WHERE c.id = NEW.chat_id;
  IF _loc IS NOT NULL AND NOT public.has_location_access(NEW.user_id, _loc) THEN
    RAISE EXCEPTION 'user % has no access to location % (chat %)', NEW.user_id, _loc, NEW.chat_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_chat_member_location_access() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_chat_members_location_guard ON public.chat_members;
CREATE TRIGGER trg_chat_members_location_guard
  BEFORE INSERT OR UPDATE OF chat_id, user_id ON public.chat_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_member_location_access();