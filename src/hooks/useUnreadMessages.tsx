import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Debounce unread count fetches to prevent cascade
let lastFetchTime = 0;
const DEBOUNCE_MS = 2000;

export const useUnreadMessages = () => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);
  const pendingFetchRef = useRef<NodeJS.Timeout | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    
    userIdRef.current = user.id;
    
    try {
      // NEW: Use last_read_at approach - single efficient query
      // Get chats where there are messages newer than last_read_at
      const { data: memberChats, error: memberError } = await supabase
        .from('chat_members')
        .select(`
          chat_id,
          last_read_at,
          chats!inner(id, is_announcement)
        `)
        .eq('user_id', user.id)
        .eq('chats.is_announcement', false);

      if (memberError || !memberChats || memberChats.length === 0) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      // Count chats with unread messages using a single query per chat
      // This is much more efficient than the old approach
      let unreadChats = 0;
      
      // Batch check: get the latest message per chat that's NOT from current user
      const chatIds = memberChats.map(cm => cm.chat_id);
      
      const { data: latestMessages } = await supabase
        .from('messages')
        .select('chat_id, created_at')
        .in('chat_id', chatIds)
        .neq('sender_id', user.id)
        .order('created_at', { ascending: false });

      if (!latestMessages || latestMessages.length === 0) {
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      // Group by chat_id to get only the latest message per chat
      const latestPerChat = new Map<string, string>();
      for (const msg of latestMessages) {
        if (!latestPerChat.has(msg.chat_id)) {
          latestPerChat.set(msg.chat_id, msg.created_at);
        }
      }

      // Compare with last_read_at
      for (const chat of memberChats) {
        const latestMsgTime = latestPerChat.get(chat.chat_id);
        if (latestMsgTime) {
          const lastRead = chat.last_read_at ? new Date(chat.last_read_at) : new Date(0);
          const latestMsg = new Date(latestMsgTime);
          if (latestMsg > lastRead) {
            unreadChats++;
          }
        }
      }

      setUnreadCount(unreadChats);
    } catch (error) {
      console.error('Error fetching unread count:', error);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [user]);

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

    // Subscribe to new messages and last_read_at updates
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
          debouncedFetch();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_members',
        },
        (payload) => {
          // Only refetch if last_read_at changed for current user
          if (payload.new && (payload.new as any).user_id === userIdRef.current) {
            debouncedFetch();
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

// Helper to update last_read_at when viewing a chat
export const markChatAsRead = async (chatId: string, userId: string) => {
  await supabase
    .from('chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', chatId)
    .eq('user_id', userId);
};
