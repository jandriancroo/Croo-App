import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Debounce unread count fetches to prevent cascade
let lastFetchTime = 0;
const DEBOUNCE_MS = 2000;

// Global refetch callback for immediate updates after marking as read
let globalRefetch: (() => void) | null = null;

export const useUnreadMessages = () => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);
  const pendingFetchRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    
    userIdRef.current = user.id;
    
    try {
      // Single efficient database call using RPC function
      const { data, error } = await supabase
        .rpc('get_unread_chat_count', { _user_id: user.id });

      if (error) {
        console.error('Error fetching unread count:', error);
        setUnreadCount(0);
      } else {
        setUnreadCount(data ?? 0);
      }
    } catch (error) {
      console.error('Error fetching unread count:', error);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Register global refetch for immediate updates
  useEffect(() => {
    globalRefetch = fetchUnreadCount;
    return () => {
      globalRefetch = null;
    };
  }, [fetchUnreadCount]);

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
    if (!user) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    fetchUnreadCount();

    // Clean up previous channel if exists
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Optimized realtime subscription:
    // 1. Filter chat_members updates to only current user (server-side filter)
    // 2. Still need broad message listener, but single RPC call is fast
    channelRef.current = supabase
      .channel(`unread-tracker-${user.id}`)
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
          filter: `user_id=eq.${user.id}` // Server-side filter - only this user's updates
        },
        () => {
          debouncedFetch();
        }
      )
      .subscribe();

    return () => {
      if (pendingFetchRef.current) clearTimeout(pendingFetchRef.current);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, fetchUnreadCount, debouncedFetch]);

  return { unreadCount, loading, refetch: fetchUnreadCount };
};

// Helper to update last_read_at when viewing a chat
// Immediately triggers a refetch of unread count (bypasses debounce)
export const markChatAsRead = async (chatId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', chatId)
    .eq('user_id', userId);
  
  if (error) {
    console.error('Error marking chat as read:', error);
  } else {
    // Immediately refetch unread count (bypass debounce)
    globalRefetch?.();
  }
};
