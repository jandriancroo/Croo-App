import { useState, useEffect, useCallback, useRef } from 'react';
import { getDisplayName } from '@/utils/displayName';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChatUnreadCounts } from '@/hooks/useChatUnreadCounts';
import { FEATURE_FLAGS } from '@/config/featureFlags';
import { toast } from 'sonner';

export interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement: boolean;
  is_arcade?: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  group_image_url: string | null;
  unreadCount?: number;
  messagePreview?: string;
  isPinned?: boolean;
  chat_members: Array<{
    user_id: string;
    is_pinned?: boolean;
    profiles: {
      id: string;
      full_name: string;
      profile_photo_url: string | null;
    };
  }>;
}

export type ViewMode = 'all' | 'groups' | 'dms' | 'announcements' | 'hiring' | 'support';

export function useMessagesData() {
  const { user } = useAuth();
  const { isAdmin, isManager, isSuperAdmin } = useUserRole();
  const { currentLocation } = useAppLocation();
  const isMobile = useIsMobile();
  const showHiringTab = isAdmin || isManager;
  const showSupportTab = isSuperAdmin;

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);
  const [isMarketplaceIconOpen, setIsMarketplaceIconOpen] = useState(false);
  const [marketplaceChatId, setMarketplaceChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChatList, setShowChatList] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredChats, setFilteredChats] = useState<Chat[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [isNewActionOpen, setIsNewActionOpen] = useState(false);
  const [selectedHiringConversation, setSelectedHiringConversation] = useState<any>(null);
  const [pendingHiringApplicationId, setPendingHiringApplicationId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlChatIdProcessed = useRef(false);

  const currentUserId = user?.id || null;
  const { counts: unreadCounts } = useChatUnreadCounts(currentLocation?.id || null);

  const chatIdsRef = useRef<Set<string>>(new Set());
  const fetchChatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ensure marketplace chat exists — fire-and-forget, only once per session
  const marketplaceChecked = useRef(false);
  const ensureMarketplaceChat = useCallback(async () => {
    if (marketplaceChecked.current || !user || !currentLocation) return;
    marketplaceChecked.current = true;

    let { data: marketplaceChats } = await supabase
      .from("chats")
      .select("id, title")
      .ilike("title", "%Shift Marketplace%");

    if (marketplaceChats && marketplaceChats.length > 1) {
      const [keepChat, ...deleteChats] = marketplaceChats;
      for (const chat of deleteChats) {
        await supabase.from("chats").delete().eq("id", chat.id);
      }
      marketplaceChats = [keepChat];
    }

    let marketplaceChat = marketplaceChats?.[0] || null;

    if (marketplaceChat && marketplaceChat.title !== "Shift Marketplace") {
      await supabase
        .from("chats")
        .update({ title: "Shift Marketplace" })
        .eq("id", marketplaceChat.id);
    }

    if (!marketplaceChat) {
      const { data: newChat } = await supabase
        .from("chats")
        .insert({
          created_by: user.id,
          is_group: true,
          title: "Shift Marketplace",
          location_id: currentLocation.id,
        })
        .select()
        .single();

      if (newChat) {
        const { data: allUsers } = await supabase.from("profiles").select("id");
        if (allUsers) {
          await supabase
            .from("chat_members")
            .insert(allUsers.map((u) => ({ chat_id: newChat.id, user_id: u.id })));
        }
      }
    }
  }, [user, currentLocation]);

  const applyViewFilter = useCallback((chatList: Chat[], mode: ViewMode) => {
    if (mode === 'hiring' || mode === 'support') {
      setFilteredChats([]);
      return;
    }
    
    let filtered = chatList;
    
    if (!FEATURE_FLAGS.ARCADE_ENABLED) {
      filtered = filtered.filter(chat => !chat.is_arcade);
    }
    
    if (mode === 'announcements') {
      filtered = filtered.filter(chat => chat.is_announcement);
    } else if (mode === 'all') {
      // Combined view: DMs + Groups (no announcements), groups auto-pinned to top
      filtered = filtered.filter(chat => !chat.is_announcement);
    }
    
    setFilteredChats(filtered);
  }, []);

  const fetchChats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      ensureMarketplaceChat();

      let query = supabase
        .from('chats')
        .select(`
          *,
          chat_members!inner(
            user_id,
            is_pinned,
            last_read_at,
            profiles(id, full_name, nickname, profile_photo_url)
          )
        `)
        .order('updated_at', { ascending: false });

      if (currentLocation) {
        query = query.eq('location_id', currentLocation.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      const userChats =
        data?.filter((chat: any) => chat.chat_members.some((m: any) => m.user_id === user.id)) || [];

      const chatIds = userChats.map((c: any) => c.id);
      chatIdsRef.current = new Set(chatIds);

      const latestPerChat = new Map<string, { id: string; sender_id: string; content: string | null; created_at: string }>();
      if (chatIds.length > 0) {
        const { data: latestMessages } = await supabase
          .from('messages')
          .select('id, chat_id, sender_id, content, created_at')
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false })
          .limit(chatIds.length * 3);

        for (const msg of latestMessages || []) {
          if (!latestPerChat.has(msg.chat_id)) {
            latestPerChat.set(msg.chat_id, {
              id: msg.id,
              sender_id: msg.sender_id,
              content: msg.content,
              created_at: msg.created_at,
            });
          }
        }
      }

      const chatsWithUnread = userChats.map((chat: any) => {
        const latest = latestPerChat.get(chat.id);
        const lastMessageTime = latest?.created_at || chat.updated_at;
        const messagePreview = latest?.content || '';

        const currentMember = chat.chat_members.find((m: any) => m.user_id === user.id);
        const lastReadAt = currentMember?.last_read_at;

        let unreadCount = 0;
        if (latest && latest.sender_id !== user.id) {
          const isUnread = !lastReadAt || new Date(latest.created_at) > new Date(lastReadAt);
          if (isUnread) unreadCount = 1;
        }

        let title = chat.title;
        if (!chat.is_group && !title) {
          const otherMember = chat.chat_members.find((m: any) => m.user_id !== user.id);
          title = otherMember?.profiles ? getDisplayName(otherMember.profiles.full_name, otherMember.profiles.nickname) : 'Direct Message';
        }

        const isPinned = currentMember?.is_pinned || false;

        return { ...chat, title, unreadCount, isPinned, messagePreview, updated_at: lastMessageTime };
      });

      const marketplaceItem = chatsWithUnread.find((c: any) => c.title === 'Shift Marketplace');
      if (marketplaceItem) {
        setMarketplaceChatId(marketplaceItem.id);
      }

      const sortedChats = chatsWithUnread
        .sort((a: any, b: any) => {
          if (a.title === 'Shift Marketplace') return -1;
          if (b.title === 'Shift Marketplace') return 1;
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
          if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });

      setChats(sortedChats);
      applyViewFilter(sortedChats, viewMode);
    } catch (error: any) {
      console.error('Error fetching chats:', error);
      toast.error('Failed to load chats');
    } finally {
      setLoading(false);
    }
  }, [currentLocation, viewMode, user, ensureMarketplaceChat, applyViewFilter]);

  const debouncedFetchChats = useCallback(() => {
    if (fetchChatsTimerRef.current) return;
    fetchChatsTimerRef.current = setTimeout(() => {
      fetchChatsTimerRef.current = null;
      fetchChats();
    }, 750);
  }, [fetchChats]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      applyViewFilter(chats, viewMode);
      return;
    }

    try {
      if (!user) return;

      const { data: matchingMessages } = await supabase
        .from('messages')
        .select('chat_id, content')
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false });

      if (!matchingMessages) {
        setFilteredChats([]);
        return;
      }

      const chatMessageMap = new Map<string, string>();
      matchingMessages.forEach(msg => {
        if (!chatMessageMap.has(msg.chat_id) && msg.content) {
          chatMessageMap.set(msg.chat_id, msg.content);
        }
      });

      const matchingChatIds = Array.from(chatMessageMap.keys());

      const modeFilteredChats = viewMode === 'announcements'
        ? chats.filter(chat => chat.is_announcement)
        : chats.filter(chat => !chat.is_announcement);

      const filtered = modeFilteredChats
        .filter(chat => 
          matchingChatIds.includes(chat.id) || 
          chat.title?.toLowerCase().includes(query.toLowerCase())
        )
        .map(chat => ({
          ...chat,
          messagePreview: chatMessageMap.get(chat.id) || undefined
        }));

      setFilteredChats(filtered);
    } catch (error) {
      console.error('Error searching chats:', error);
      toast.error('Failed to search messages');
    }
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setSearchQuery('');
    setSelectedHiringConversation(null);
    if (mode === 'hiring' || mode === 'support') {
      setSelectedChatId(null);
    } else {
      setSelectedChatId(null);
      applyViewFilter(chats, mode);
    }
  };

  const handleTogglePin = async (chatId: string, currentlyPinned: boolean) => {
    if (!currentUserId) return;
    
    try {
      const { error } = await supabase
        .from('chat_members')
        .update({ is_pinned: !currentlyPinned })
        .eq('chat_id', chatId)
        .eq('user_id', currentUserId);

      if (error) throw error;
      
      toast.success(currentlyPinned ? 'Chat unpinned' : 'Chat pinned');
      fetchChats();
    } catch (error) {
      console.error('Error toggling pin:', error);
      toast.error('Failed to update pin status');
    }
  };

  // Realtime subscription + initial fetch
  useEffect(() => {
    if (currentLocation) {
      fetchChats();
    }

    const channel = supabase
      .channel('messages-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const chatId = (payload.new as any)?.chat_id as string | undefined;
          if (!chatId) return;
          if (!chatIdsRef.current.has(chatId)) return;
          debouncedFetchChats();
        }
      )
      .subscribe();

    return () => {
      if (fetchChatsTimerRef.current) {
        clearTimeout(fetchChatsTimerRef.current);
        fetchChatsTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [currentLocation, fetchChats, debouncedFetchChats]);

  // Handle URL chat parameter
  useEffect(() => {
    const urlChatId = searchParams.get('chat');
    const urlTab = searchParams.get('tab');
    const urlApplicationId = searchParams.get('applicationId');
    
    if (urlTab === 'hiring' && urlApplicationId && !urlChatIdProcessed.current) {
      setViewMode('hiring');
      setPendingHiringApplicationId(urlApplicationId);
      urlChatIdProcessed.current = true;
      setShowChatList(false);
      setSearchParams({}, { replace: true });
      return;
    }
    
    if (!urlChatId || urlChatIdProcessed.current || loading || chats.length === 0) return;

    const targetChat = chats.find(c => c.id === urlChatId);
    
    if (targetChat) {
      if (targetChat.is_announcement && viewMode !== 'announcements') {
        setViewMode('announcements');
        applyViewFilter(chats, 'announcements');
      } else if (!targetChat.is_announcement && viewMode !== 'all') {
        setViewMode('all');
        applyViewFilter(chats, 'all');
      }
      
      setSelectedChatId(urlChatId);
      setShowChatList(false);
      urlChatIdProcessed.current = true;
      setSearchParams({}, { replace: true });
    } else {
      if (urlChatId === marketplaceChatId) {
        setViewMode('groups');
        setSelectedChatId(urlChatId);
        setShowChatList(false);
        urlChatIdProcessed.current = true;
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, chats, loading, viewMode, marketplaceChatId, setSearchParams, applyViewFilter]);

  return {
    user,
    currentUserId,
    currentLocation,
    isMobile,
    isAdmin,
    isManager,
    isSuperAdmin,
    showHiringTab,
    showSupportTab,
    chats,
    selectedChatId,
    setSelectedChatId,
    isNewChatOpen,
    setIsNewChatOpen,
    isAnnouncementOpen,
    setIsAnnouncementOpen,
    isMarketplaceIconOpen,
    setIsMarketplaceIconOpen,
    marketplaceChatId,
    loading,
    showChatList,
    setShowChatList,
    searchQuery,
    filteredChats,
    viewMode,
    isNewActionOpen,
    setIsNewActionOpen,
    selectedHiringConversation,
    setSelectedHiringConversation,
    pendingHiringApplicationId,
    setPendingHiringApplicationId,
    unreadCounts,
    fetchChats,
    handleSearch,
    handleViewModeChange,
    handleTogglePin,
  };
}
