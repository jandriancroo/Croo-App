// THE ONE place a typed chat message is sent (with its push), a one-to-one chat is found or started for Theo,
// and a message is unsent. Used by the chat window and by Theo's Send tap. Runs in the browser as the
// signed-in person, so the database's chat rules decide what is allowed.
// Not moved here (they are not Theo actions): GIF and file sends in the chat window, share-task, shift-offer, announcements.
import { supabase } from '@/integrations/supabase/client';
import { getDisplayName } from '@/utils/displayName';

/**
 * The push the chat window has always sent after a message: to every other member, titled with the sender's name.
 * The 3-minute-per-chat limit and each person's alert settings live in the push function, not here.
 */
export async function pushChatMessage(chatId: string, senderId: string, body: string, type = 'message', messageId?: string | null) {
  try {
    const { data: members } = await supabase.from('chat_members').select('user_id').eq('chat_id', chatId).neq('user_id', senderId);
    if (members && members.length > 0) {
      const { data: senderProfile } = await supabase.from('profiles').select('full_name, nickname').eq('id', senderId).single();
      await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: members.map(m => m.user_id),
          sender_id: senderId,
          title: getDisplayName(senderProfile?.full_name, senderProfile?.nickname) || 'New Message',
          body,
          notification_type: 'chat_messages',
          data: messageId ? { chat_id: chatId, type, message_id: messageId } : { chat_id: chatId, type },
        },
      });
    }
  } catch (err) {
    console.error('Push notification error:', err);
  }
}

/** Send one typed message (optionally a threaded reply), then its push (not awaited, as before). */
export async function sendChatMessage(opts: { chatId: string; senderId: string; content: string; parentMessageId?: string | null }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: opts.chatId, sender_id: opts.senderId, content: opts.content || null, parent_message_id: opts.parentMessageId || null })
    .select('id, created_at')
    .single();
  if (error) throw error;
  void pushChatMessage(opts.chatId, opts.senderId, opts.content.substring(0, 100), 'message', (data as any)?.id);
  return data as { id: string; created_at: string };
}

/**
 * Theo's new DM: reuse the existing one-to-one chat with this person at this store, else start one
 * (same fields the new-chat screen writes). Never reuses groups, announcements or the Shift Marketplace.
 * The manual new-chat screen is NOT changed and keeps its own create.
 */
export async function findOrCreateDm(opts: { userId: string; otherUserId: string; locationId: string }) {
  const { data: mine } = await supabase.from('chat_members').select('chat_id').eq('user_id', opts.userId);
  const ids = (mine || []).map((m) => m.chat_id);
  if (ids.length) {
    const { data: dms } = await supabase.from('chats').select('id, chat_members(user_id)')
      .in('id', ids).eq('location_id', opts.locationId).eq('is_group', false).or('is_announcement.is.null,is_announcement.eq.false');
    const hit = (dms || []).find((c: any) => {
      const m = (c.chat_members || []).map((x: any) => x.user_id);
      return m.length === 2 && m.includes(opts.userId) && m.includes(opts.otherUserId);
    });
    if (hit) return { chatId: hit.id as string, created: false };
  }
  const { data: chat, error } = await supabase.from('chats')
    .insert({ title: null, is_group: false, created_by: opts.userId, location_id: opts.locationId }).select('id').single();
  if (error) throw error;
  const { error: me } = await supabase.from('chat_members').insert([{ chat_id: chat.id, user_id: opts.otherUserId }, { chat_id: chat.id, user_id: opts.userId }]);
  if (me) throw me;
  return { chatId: chat.id as string, created: true };
}

/** Unsend for everyone (the chat window's long-press, and Theo's Unsend). Sender only, by the database's rule. */
export async function unsendMessage(messageId: string, userId: string) {
  const { error } = await supabase.from('messages').update({
    is_deleted_for_everyone: true, deleted_by: userId, deleted_at: new Date().toISOString(),
    content: null, attachment_url: null, attachment_type: null,
  }).eq('id', messageId);
  if (error) throw error;
}
