import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useUnreadMessages = () => {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      // Get all chats the user is a member of (excluding announcements)
      const { data: memberChats } = await supabase
        .from('chat_members')
        .select('chat_id, chats!inner(id, is_announcement)')
        .eq('user_id', user.id)
        .eq('chats.is_announcement', false);

      if (!memberChats || memberChats.length === 0) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      const chatIds = memberChats.map(cm => cm.chat_id);

      // Count unread chats (chats with at least one unread message)
      let unreadChats = 0;

      for (const chatId of chatIds) {
        // Get the latest message in this chat not sent by the user
        const { data: latestMessage } = await supabase
          .from('messages')
          .select('id, created_at')
          .eq('chat_id', chatId)
          .neq('sender_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestMessage) continue;

        // Check if user has read this message
        const { data: readReceipt } = await supabase
          .from('message_read_receipts')
          .select('id')
          .eq('message_id', latestMessage.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!readReceipt) {
          unreadChats++;
        }
      }

      setUnreadCount(unreadChats);
    } catch (error) {
      console.error('Error fetching unread count:', error);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();

    // Subscribe to new messages
    const messageChannel = supabase
      .channel('unread-messages')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        () => {
          fetchUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_read_receipts'
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
    };
  }, [fetchUnreadCount]);

  return { unreadCount, loading, refetch: fetchUnreadCount };
};
