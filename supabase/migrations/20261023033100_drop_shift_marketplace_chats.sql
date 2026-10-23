-- Retire the per-store "Shift Marketplace" group chats. Open shifts now live as cards in the feed
-- (src/components/feed/ShiftSwapBar.tsx, read straight from shift_offers).
-- Deletes ONLY those chats, their messages and their members. shift_offers / shift_offer_claims are
-- NOT touched: they have no foreign key to chats or messages, so nothing cascades to them.
-- (Other tables with chat_id ON DELETE SET NULL keep their rows.)
DO $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM public.chats WHERE title = 'Shift Marketplace' AND is_group = true;
  IF ids IS NULL THEN RETURN; END IF;
  DELETE FROM public.messages WHERE chat_id = ANY(ids);
  DELETE FROM public.chat_members WHERE chat_id = ANY(ids);
  DELETE FROM public.chats WHERE id = ANY(ids);
END $$;
