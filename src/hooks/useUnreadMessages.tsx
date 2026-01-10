import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Event-based refetch trigger for instant badge updates
const refetchEvent = new EventTarget();
const REFETCH_EVENT = 'refetch-unread';

export const useUnreadMessages = () => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    
    try {
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

  // Listen for refetch events - INSTANT, no debounce
  useEffect(() => {
    const handler = () => {
      fetchUnreadCount();
    };
    refetchEvent.addEventListener(REFETCH_EVENT, handler);
    return () => {
      refetchEvent.removeEventListener(REFETCH_EVENT, handler);
    };
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

    // Realtime subscription for new messages and read status updates
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
          // Small delay to let DB settle, then fetch
          setTimeout(fetchUnreadCount, 100);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_members',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          // Immediate fetch on read status update
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, fetchUnreadCount]);

  return { unreadCount, loading, refetch: fetchUnreadCount };
};

// Helper to update last_read_at when viewing a chat
// Triggers INSTANT refetch - no debounce
export const markChatAsRead = async (chatId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('chat_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('chat_id', chatId)
    .eq('user_id', userId);
  
  if (error) {
    console.error('Error marking chat as read:', error);
  } else {
    // Dispatch event to trigger INSTANT refetch
    refetchEvent.dispatchEvent(new Event(REFETCH_EVENT));
  }
};
