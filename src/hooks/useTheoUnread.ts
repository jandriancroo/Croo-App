import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';

export interface TheoUnreadState {
  count: number;
  preview: string | null;
  latestId: string | null;
  latestCreatedAt: string | null;
  markRead: (messageId?: string) => Promise<void>;
}

/**
 * Tracks Theo unread assistant messages for the current user + location.
 * - Reads from RPC `get_theo_unread`.
 * - Subscribes to realtime inserts on `theo_chat_messages` so the badge updates instantly.
 * - `markRead()` (no arg) marks the latest known unread as read; pass an id to mark up to that id.
 */
export function useTheoUnread(): TheoUnreadState {
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const queryClient = useQueryClient();

  const locationId = currentLocation?.id ?? null;
  const userId = user?.id ?? null;

  const queryKey = useMemo(
    () => ['theo-unread', userId, locationId] as const,
    [userId, locationId],
  );

  const { data } = useQuery({
    queryKey,
    enabled: !!userId && !!locationId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await (supabase as any).rpc('get_theo_unread', {
        p_location_id: locationId,
      });
      if (error) {
        console.warn('[useTheoUnread] rpc error', error);
        return null;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { count: 0, preview: null, latestId: null, latestCreatedAt: null };
      return {
        count: Number(row.unread_count ?? 0),
        preview: (row.latest_preview as string) ?? null,
        latestId: (row.latest_message_id as string) ?? null,
        latestCreatedAt: (row.latest_created_at as string) ?? null,
      };
    },
  });

  // Realtime: when a new assistant message arrives, refresh the count.
  useEffect(() => {
    if (!userId || !locationId) return;
    const channel = supabase
      .channel(`theo-unread-${userId}-${locationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'theo_chat_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const row = payload?.new;
          if (!row || row.role !== 'assistant') return;
          if (row.location_id !== locationId) return;
          queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, locationId, queryClient, queryKey]);

  const markReadMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!locationId || !messageId) return;
      const { error } = await (supabase as any).rpc('mark_theo_read', {
        p_location_id: locationId,
        p_message_id: messageId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    count: data?.count ?? 0,
    preview: data?.preview ?? null,
    latestId: data?.latestId ?? null,
    latestCreatedAt: data?.latestCreatedAt ?? null,
    markRead: async (messageId?: string) => {
      const target = messageId ?? data?.latestId ?? null;
      if (!target) return;
      await markReadMutation.mutateAsync(target);
    },
  };
}
