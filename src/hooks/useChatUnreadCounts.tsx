import { useState, useEffect, useCallback, useRef } from 'react';
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

export function useChatUnreadCounts(locationId: string | null) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<ChatUnreadCounts>({
    chats: 0,
    announcements: 0,
    marketplace: 0,
    hiring: 0,
    support: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!user || !locationId) {
      setCounts({ chats: 0, announcements: 0, marketplace: 0, hiring: 0, support: 0, total: 0 });
      setLoading(false);
      return;
    }

    const startTime = performance.now();

    try {
      // Fetch all chats user is member of with their unread status
      const { data: memberChats, error: memberError } = await supabase
        .from('chat_members')
        .select(`
          chat_id,
          last_read_at,
          chats!inner(
            id,
            title,
            is_announcement,
            is_group,
            location_id,
            updated_at
          )
        `)
        .eq('user_id', user.id);

      if (memberError) throw memberError;

      // Get latest message per chat for accurate unread detection
      const chatIds = memberChats?.map(m => m.chat_id) || [];
      
      if (chatIds.length === 0) {
        setCounts({ chats: 0, announcements: 0, marketplace: 0, hiring: 0, support: 0, total: 0 });
        setLoading(false);
        return;
      }

      // Batch fetch latest messages
      const { data: latestMessages } = await supabase
        .from('messages')
        .select('chat_id, sender_id, created_at')
        .in('chat_id', chatIds)
        .order('created_at', { ascending: false });

      // Build map of latest message per chat
      const latestPerChat = new Map<string, { sender_id: string; created_at: string }>();
      for (const msg of latestMessages || []) {
        if (!latestPerChat.has(msg.chat_id)) {
          latestPerChat.set(msg.chat_id, { sender_id: msg.sender_id, created_at: msg.created_at });
        }
      }

      // Calculate unread counts by category
      let chatsCount = 0;
      let announcementsCount = 0;
      let marketplaceCount = 0;

      for (const member of memberChats || []) {
        const chat = member.chats as any;
        if (!chat || chat.location_id !== locationId) continue;

        const latest = latestPerChat.get(member.chat_id);
        if (!latest) continue;

        // Check if unread: latest message is from someone else AND after last_read_at
        const isUnread = 
          latest.sender_id !== user.id &&
          (!member.last_read_at || new Date(latest.created_at) > new Date(member.last_read_at));

        if (!isUnread) continue;

        // Categorize
        if (chat.title === 'Shift Marketplace') {
          marketplaceCount++;
        } else if (chat.is_announcement) {
          announcementsCount++;
        } else {
          chatsCount++;
        }
      }

      // For hiring and support, we'd need separate queries if those have their own tables
      // For now, keeping them at 0 since they use different systems
      const hiringCount = 0;
      const supportCount = 0;

      const total = chatsCount + announcementsCount + marketplaceCount + hiringCount + supportCount;

      setCounts({
        chats: chatsCount,
        announcements: announcementsCount,
        marketplace: marketplaceCount,
        hiring: hiringCount,
        support: supportCount,
        total,
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
      setCounts({ chats: 0, announcements: 0, marketplace: 0, hiring: 0, support: 0, total: 0 });
      setLoading(false);
      return;
    }

    fetchCounts();

    // Clean up previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Realtime subscription for instant badge updates
    channelRef.current = supabase
      .channel(`chat-counts-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => {
          // Instant fetch on new message
          fetchCounts();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_members', filter: `user_id=eq.${user.id}` },
        () => {
          // Instant fetch on read status update
          fetchCounts();
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, locationId, fetchCounts]);

  return { counts, loading, refetch: fetchCounts };
}
