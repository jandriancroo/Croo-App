import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Debounce unread count fetches to prevent cascade
let lastFetchTime = 0;
const DEBOUNCE_MS = 2000;

export const useUnreadMessages = () => {
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);
  const pendingFetchRef = useRef<NodeJS.Timeout | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }
      
      userIdRef.current = user.id;

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

      // Get the latest message per chat not sent by current user, using a single query
      const { data: latestMessages } = await supabase
        .from('messages')
        .select('id, chat_id, created_at')
        .in('chat_id', chatIds)
        .neq('sender_id', user.id)
        .order('created_at', { ascending: false });

      if (!latestMessages || latestMessages.length === 0) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      // Group by chat_id to get only the latest message per chat
      const latestPerChat = new Map<string, { id: string; created_at: string }>();
      for (const msg of latestMessages) {
        if (!latestPerChat.has(msg.chat_id)) {
          latestPerChat.set(msg.chat_id, { id: msg.id, created_at: msg.created_at });
        }
      }

      const messageIds = Array.from(latestPerChat.values()).map(m => m.id);

      // Get all read receipts for these messages in a single query
      const { data: readReceipts } = await supabase
        .from('message_read_receipts')
        .select('message_id')
        .in('message_id', messageIds)
        .eq('user_id', user.id);

      const readMessageIds = new Set(readReceipts?.map(r => r.message_id) || []);

      // Count unread chats
      let unreadChats = 0;
      for (const [, msg] of latestPerChat) {
        if (!readMessageIds.has(msg.id)) {
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

  // Debounced fetch that prevents hammering the database
  const debouncedFetch = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTime < DEBOUNCE_MS) {
      // Schedule a fetch after debounce window if not already scheduled
      if (!pendingFetchRef.current) {
        pendingFetchRef.current = setTimeout(() => {
          pendingFetchRef.current = null;
          lastFetchTime = Date.now();
          fetchUnreadCount();
        }, DEBOUNCE_MS);
      }
      return;
    }
    lastFetchTime = now;
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    fetchUnreadCount();

    // Subscribe to new messages and read receipts
    const messageChannel = supabase
      .channel('unread-messages-tracker')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        () => {
          debouncedFetch(); // Use debounced version
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_read_receipts'
        },
        (payload) => {
          // Only refetch if this read receipt is for the current user
          if (payload.new && (payload.new as any).user_id === userIdRef.current) {
            debouncedFetch(); // Use debounced version
          }
        }
      )
      .subscribe();

    return () => {
      if (pendingFetchRef.current) clearTimeout(pendingFetchRef.current);
      supabase.removeChannel(messageChannel);
    };
  }, [fetchUnreadCount, debouncedFetch]);

  return { unreadCount, loading, refetch: fetchUnreadCount };
};
