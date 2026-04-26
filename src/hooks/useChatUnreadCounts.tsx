import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export interface ChatUnreadCounts {
  chats: number;
  announcements: number;
  marketplace: number;
  hiring: number;
  support: number;
  total: number;
}

// Event-based instant refetch
const refetchEvent = new EventTarget();
const REFETCH_EVENT = 'refetch-chat-counts';

export const triggerChatCountRefetch = () => {
  refetchEvent.dispatchEvent(new Event(REFETCH_EVENT));
};

const DEFAULT_COUNTS: ChatUnreadCounts = {
  chats: 0,
  announcements: 0,
  marketplace: 0,
  hiring: 0,
  support: 0,
  total: 0,
};

export function useChatUnreadCounts(locationId: string | null) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<ChatUnreadCounts>(DEFAULT_COUNTS);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!user || !locationId) {
      setCounts(DEFAULT_COUNTS);
      setLoading(false);
      return;
    }

    const startTime = performance.now();

    try {
      // Single RPC call to get all counts
      const { data, error } = await supabase.rpc('get_chat_unread_counts', {
        _user_id: user.id,
        _location_id: locationId,
      });

      if (error) throw error;

      const result = data as unknown as ChatUnreadCounts;
      setCounts({
        chats: result?.chats ?? 0,
        announcements: result?.announcements ?? 0,
        marketplace: result?.marketplace ?? 0,
        hiring: result?.hiring ?? 0,
        support: result?.support ?? 0,
        total: result?.total ?? 0,
      });

      const endTime = performance.now();
      console.log(`[ChatUnreadCounts] Fetched in ${(endTime - startTime).toFixed(1)}ms`);
    } catch (error) {
      console.error('Error fetching chat unread counts:', error);
    } finally {
      setLoading(false);
    }
  }, [user, locationId]);

  // Listen for instant refetch events
  useEffect(() => {
    const handler = () => fetchCounts();
    refetchEvent.addEventListener(REFETCH_EVENT, handler);
    return () => refetchEvent.removeEventListener(REFETCH_EVENT, handler);
  }, [fetchCounts]);

  // Initial fetch and realtime subscription
  useEffect(() => {
    if (!user || !locationId) {
      setCounts(DEFAULT_COUNTS);
      setLoading(false);
      return;
    }

    fetchCounts();

    // Debounced refetch to prevent cascading calls from rapid realtime events
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      // Skip work entirely if tab is hidden — we'll resync on return
      if (typeof document !== 'undefined' && document.hidden) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchCounts();
      }, 1500); // Wait 1.5s after last event before fetching
    };

    const subscribe = () => {
      // Clean up previous channel before re-subscribing
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      channelRef.current = supabase
        .channel(`chat-counts-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          debouncedFetch
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'chat_members', filter: `user_id=eq.${user.id}` },
          debouncedFetch
        )
        .subscribe();
    };

    const unsubscribe = () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };

    // Start subscription only if visible
    if (typeof document === 'undefined' || !document.hidden) {
      subscribe();
    }

    // Pause realtime + DB chatter while tab is hidden; resume on return.
    // This is the biggest savings — chat events stop firing for inactive tabs.
    const onVisibility = () => {
      if (document.hidden) {
        unsubscribe();
      } else {
        subscribe();
        fetchCounts(); // one fresh fetch on return
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [user, locationId, fetchCounts]);

  return { counts, loading, refetch: fetchCounts };
}
