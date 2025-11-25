import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const useUnreadMessages = () => {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchUnreadCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUnreadCount(0);
        return;
      }

      // Get all chats the user is a member of
      const { data: memberChats } = await supabase
        .from('chat_members')
        .select('chat_id')
        .eq('user_id', user.id);

      if (!memberChats || memberChats.length === 0) {
        setUnreadCount(0);
        return;
      }

      const chatIds = memberChats.map(cm => cm.chat_id);

      // Get all messages in these chats
      const { data: messages } = await supabase
        .from('messages')
        .select('id, sender_id')
        .in('chat_id', chatIds)
        .neq('sender_id', user.id); // Exclude messages sent by current user

      if (!messages || messages.length === 0) {
        setUnreadCount(0);
        return;
      }

      const messageIds = messages.map(m => m.id);

      // Get read receipts for these messages by current user
      const { data: readReceipts } = await supabase
        .from('message_read_receipts')
        .select('message_id')
        .in('message_id', messageIds)
        .eq('user_id', user.id);

      const readMessageIds = new Set(readReceipts?.map(r => r.message_id) || []);
      
      // Count unread messages
      const unread = messages.filter(m => !readMessageIds.has(m.id)).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Error fetching unread count:', error);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  };

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
  }, []);

  return { unreadCount, loading };
};
