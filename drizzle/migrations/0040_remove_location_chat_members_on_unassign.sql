CREATE OR REPLACE FUNCTION public.remove_location_chat_members_on_unassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.chat_members
  WHERE user_id = OLD.user_id
    AND chat_id IN (
      SELECT id FROM public.chats
      WHERE location_id IS NOT NULL
        AND location_id = OLD.location_id
    );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_remove_location_chat_members_on_unassign ON public.user_locations;
CREATE TRIGGER trg_remove_location_chat_members_on_unassign
AFTER DELETE ON public.user_locations
FOR EACH ROW
EXECUTE FUNCTION public.remove_location_chat_members_on_unassign();