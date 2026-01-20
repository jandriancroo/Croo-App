import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowLeft, Megaphone, ArrowLeftRight, Briefcase, MessageCircle, Headphones } from 'lucide-react';
import { ChatList } from '@/components/messages/ChatList';
import { ChatWindow } from '@/components/messages/ChatWindow';
import { NewChatDialog } from '@/components/messages/NewChatDialog';
import { AnnouncementDialog } from '@/components/messages/AnnouncementDialog';
import { MarketplaceIconSelector } from '@/components/messages/MarketplaceIconSelector';
import { ChatSearch } from '@/components/messages/ChatSearch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { HiringChatList } from '@/components/messages/HiringChatList';
import { HiringChatPanel } from '@/components/hiring/HiringChatPanel';
import { SupportChatPanel } from '@/components/support/SupportChatPanel';
import { SupportButton } from '@/components/support/SupportButton';
import { ChatTabBadge } from '@/components/messages/ChatTabBadge';
import { useChatUnreadCounts, triggerChatCountRefetch } from '@/hooks/useChatUnreadCounts';
interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement: boolean;
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

export default function Messages() {
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
  const [viewMode, setViewMode] = useState<'chats' | 'announcements' | 'marketplace' | 'hiring' | 'support'>('chats');
  const [selectedHiringConversation, setSelectedHiringConversation] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlChatIdProcessed = useRef(false);

  // Use user.id from auth context
  const currentUserId = user?.id || null;

  // Unread counts for tab badges
  const { counts: unreadCounts } = useChatUnreadCounts(currentLocation?.id || null);

  const chatIdsRef = useRef<Set<string>>(new Set());
  const fetchChatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchChats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {

      // Ensure shift marketplace chat exists (single instance)
      let { data: marketplaceChats } = await supabase
        .from("chats")
        .select("id, title")
        .ilike("title", "%Shift Marketplace%");

      // Remove duplicates if any exist
      if (marketplaceChats && marketplaceChats.length > 1) {
        const [keepChat, ...deleteChats] = marketplaceChats;
        for (const chat of deleteChats) {
          await supabase.from("chats").delete().eq("id", chat.id);
        }
        marketplaceChats = [keepChat];
      }

      let marketplaceChat = marketplaceChats?.[0] || null;

      // Update existing chat to remove rotating icon if present
      if (marketplaceChat && marketplaceChat.title !== "Shift Marketplace") {
        await supabase
          .from("chats")
          .update({ title: "Shift Marketplace" })
          .eq("id", marketplaceChat.id);
      }

      // Create if doesn't exist
      if (!marketplaceChat && currentLocation) {
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
          marketplaceChat = newChat;

          // Add all users to marketplace chat
          const { data: allUsers } = await supabase.from("profiles").select("id");

          if (allUsers) {
            await supabase
              .from("chat_members")
              .insert(
                allUsers.map((u) => ({
                  chat_id: newChat.id,
                  user_id: u.id,
                }))
              );
          }
        }
      }

      // Filter chats by current location - include last_read_at for unread detection
      let query = supabase
        .from('chats')
        .select(`
          *,
          chat_members!inner(
            user_id,
            is_pinned,
            last_read_at,
            profiles(id, full_name, profile_photo_url)
          )
        `)
        .order('updated_at', { ascending: false });

      if (currentLocation) {
        query = query.eq('location_id', currentLocation.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter to only chats where current user is a member
      const userChats =
        data?.filter((chat: any) => chat.chat_members.some((m: any) => m.user_id === user.id)) || [];

      const chatIds = userChats.map((c: any) => c.id);
      chatIdsRef.current = new Set(chatIds);

      // Bulk fetch latest message per chat
      const latestPerChat = new Map<string, { id: string; sender_id: string; content: string | null; created_at: string }>();
      if (chatIds.length > 0) {
        const { data: latestMessages } = await supabase
          .from('messages')
          .select('id, chat_id, sender_id, content, created_at')
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false });

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

        // Get current user's membership to check last_read_at
        const currentMember = chat.chat_members.find((m: any) => m.user_id === user.id);
        const lastReadAt = currentMember?.last_read_at;

        // Unread if: latest message is from someone else AND after last_read_at
        let unreadCount = 0;
        if (latest && latest.sender_id !== user.id) {
          const isUnread = !lastReadAt || new Date(latest.created_at) > new Date(lastReadAt);
          if (isUnread) unreadCount = 1;
        }

        // For DMs, set title to the other person's name
        let title = chat.title;
        if (!chat.is_group && !title) {
          const otherMember = chat.chat_members.find((m: any) => m.user_id !== user.id);
          title = otherMember?.profiles?.full_name || 'Direct Message';
        }

        const isPinned = currentMember?.is_pinned || false;

        return { ...chat, title, unreadCount, isPinned, messagePreview, updated_at: lastMessageTime };
      });

      // Find and store marketplace chat ID
      const marketplaceItem = chatsWithUnread.find((c: any) => c.title === 'Shift Marketplace');
      if (marketplaceItem) {
        setMarketplaceChatId(marketplaceItem.id);
      }

      // Sort chats: pinned first, then unread, then by updated_at (excluding marketplace from regular list)
      const sortedChats = chatsWithUnread
        .filter((c: any) => c.title !== 'Shift Marketplace')
        .sort((a: any, b: any) => {
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
  }, [currentLocation, viewMode, user]);

  const debouncedFetchChats = useCallback(() => {
    if (fetchChatsTimerRef.current) return;
    fetchChatsTimerRef.current = setTimeout(() => {
      fetchChatsTimerRef.current = null;
      fetchChats();
    }, 750);
  }, [fetchChats]);

  const applyViewFilter = (chatList: Chat[], mode: 'chats' | 'announcements' | 'marketplace' | 'hiring' | 'support') => {
    if (mode === 'marketplace' || mode === 'hiring' || mode === 'support') {
      // Marketplace, Hiring, and Support are handled separately
      setFilteredChats([]);
      return;
    }
    const filtered = mode === 'announcements' 
      ? chatList.filter(chat => chat.is_announcement)
      : chatList.filter(chat => !chat.is_announcement);
    setFilteredChats(filtered);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      applyViewFilter(chats, viewMode);
      return;
    }

    try {
      if (!user) return;

      // Search for messages containing the query
      const { data: matchingMessages } = await supabase
        .from('messages')
        .select('chat_id, content')
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false });

      if (!matchingMessages) {
        setFilteredChats([]);
        return;
      }

      // Get unique chat IDs and create a map of chat_id to first matching message
      const chatMessageMap = new Map<string, string>();
      matchingMessages.forEach(msg => {
        if (!chatMessageMap.has(msg.chat_id) && msg.content) {
          chatMessageMap.set(msg.chat_id, msg.content);
        }
      });

      const matchingChatIds = Array.from(chatMessageMap.keys());

      // Filter chats based on view mode first, then apply search
      const modeFilteredChats = viewMode === 'announcements'
        ? chats.filter(chat => chat.is_announcement)
        : viewMode === 'chats'
        ? chats.filter(chat => !chat.is_announcement)
        : [];

      // Then filter by search criteria
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

  const handleViewModeChange = (mode: 'chats' | 'announcements' | 'marketplace' | 'hiring' | 'support') => {
    setViewMode(mode);
    setSearchQuery('');
    setSelectedHiringConversation(null);
    if (mode === 'marketplace' && marketplaceChatId) {
      setSelectedChatId(marketplaceChatId);
    } else if (mode === 'hiring' || mode === 'support') {
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

  useEffect(() => {
    if (currentLocation) {
      fetchChats();
    }

    // Subscribe to INSERTs only; debounce to avoid UI lockups
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

  // Handle URL chat parameter - auto-open the chat from URL
  useEffect(() => {
    const urlChatId = searchParams.get('chat');
    if (!urlChatId || urlChatIdProcessed.current || loading || chats.length === 0) return;

    // Find the chat in our list to determine if it's an announcement
    const targetChat = chats.find(c => c.id === urlChatId);
    
    if (targetChat) {
      // Switch to correct view mode
      if (targetChat.is_announcement && viewMode !== 'announcements') {
        setViewMode('announcements');
        applyViewFilter(chats, 'announcements');
      } else if (!targetChat.is_announcement && viewMode !== 'chats') {
        setViewMode('chats');
        applyViewFilter(chats, 'chats');
      }
      
      // Select the chat
      setSelectedChatId(urlChatId);
      setShowChatList(false); // On mobile, show the chat window
      urlChatIdProcessed.current = true;
      
      // Clear the URL param after processing
      setSearchParams({}, { replace: true });
    } else {
      // Chat not in our list - might be a chat we need to fetch directly
      // Check if it's the marketplace
      if (urlChatId === marketplaceChatId) {
        setViewMode('marketplace');
        setSelectedChatId(urlChatId);
        setShowChatList(false);
        urlChatIdProcessed.current = true;
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, chats, loading, viewMode, marketplaceChatId, setSearchParams]);

  return (
    <Layout>
      {/* Desktop Layout */}
      <div className="hidden md:flex h-[calc(100vh-12rem)] gap-4">
        {/* Desktop: Chat List Sidebar */}
        <div className="w-80 border-r border-border bg-card rounded-lg p-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold">Chat</h1>
            <div className="flex gap-2">
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsAnnouncementOpen(true)}
                  className="gap-2"
                >
                  <Megaphone className="h-4 w-4" />
                  Announce
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setIsNewChatOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New
              </Button>
            </div>
          </div>
          
          <Tabs value={viewMode} onValueChange={(value) => handleViewModeChange(value as 'chats' | 'announcements' | 'marketplace' | 'hiring' | 'support')} className="mb-4">
            <TabsList className={`grid w-full ${showSupportTab ? 'grid-cols-3 gap-1' : 'grid-cols-4'} h-10 p-1 gap-1`}>
              <TabsTrigger value="chats" className="h-8 relative" title="Chats">
                <MessageCircle className="h-4 w-4" />
                <ChatTabBadge count={unreadCounts.chats} />
              </TabsTrigger>
              <TabsTrigger value="announcements" className="h-8 relative" title="Announcements">
                <Megaphone className="h-4 w-4" />
                <ChatTabBadge count={unreadCounts.announcements} />
              </TabsTrigger>
              <TabsTrigger value="marketplace" className="h-8 relative" title="Shift Marketplace">
                <ArrowLeftRight className="h-4 w-4" />
                <ChatTabBadge count={unreadCounts.marketplace} />
              </TabsTrigger>
              {!showSupportTab && (
                <TabsTrigger 
                  value="hiring" 
                  className={`h-8 relative ${!showHiringTab ? 'invisible' : ''}`} 
                  title="Hiring"
                  disabled={!showHiringTab}
                >
                  <Briefcase className="h-4 w-4" />
                  <ChatTabBadge count={unreadCounts.hiring} />
                </TabsTrigger>
              )}
            </TabsList>
            {showSupportTab && (
              <TabsList className="grid w-full grid-cols-2 h-10 p-1 gap-1 mt-1">
                <TabsTrigger value="hiring" className="h-8 relative" title="Hiring">
                  <Briefcase className="h-4 w-4" />
                  <ChatTabBadge count={unreadCounts.hiring} />
                </TabsTrigger>
                <TabsTrigger value="support" className="h-8 relative" title="Support">
                  <Headphones className="h-4 w-4" />
                  <ChatTabBadge count={unreadCounts.support} />
                </TabsTrigger>
              </TabsList>
            )}
          </Tabs>
          
          {viewMode === 'hiring' ? (
            <HiringChatList
              onSelectConversation={(conv) => setSelectedHiringConversation(conv)}
              selectedId={selectedHiringConversation?.id}
            />
          ) : viewMode === 'support' ? (
            null // Support panel takes full width, no sidebar list needed
          ) : viewMode !== 'marketplace' && (
            <>
              <div className="mb-4">
                <ChatSearch onSearch={handleSearch} placeholder="Search all chats..." />
              </div>
              <ChatList
                chats={filteredChats}
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
                onTogglePin={handleTogglePin}
                loading={loading}
                searchQuery={searchQuery}
                currentUserId={currentUserId}
              />
            </>
          )}
        </div>

        {/* Desktop: Chat Window */}
        <div className={`${viewMode === 'support' ? 'flex-1' : 'flex-1'} bg-card rounded-lg flex min-w-0`}>
          {viewMode === 'support' ? (
            <div className="w-full h-full">
              <SupportChatPanel />
            </div>
          ) : viewMode === 'hiring' && selectedHiringConversation ? (
            <div className="p-4 w-full">
              <HiringChatPanel
                applicationId={selectedHiringConversation.application_id}
                applicantName={selectedHiringConversation.application?.full_name || 'Applicant'}
              />
            </div>
          ) : selectedChatId || viewMode === 'marketplace' ? (
            <div className="w-full">
              <ChatWindow
                chatId={viewMode === 'marketplace' ? marketplaceChatId : selectedChatId}
                chatDetails={chats.find(c => c.id === (viewMode === 'marketplace' ? marketplaceChatId : selectedChatId)) || null}
                onChatDeleted={() => {
                  setSelectedChatId(null);
                  if (viewMode === 'marketplace') {
                    setViewMode('chats');
                  }
                  fetchChats();
                }}
                onChatUpdated={fetchChats}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground w-full">
              <div className="text-center">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a chat to start messaging</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="flex md:hidden h-[calc(100vh-12rem)] flex-col bg-card rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Chat</h2>
          <div className="flex gap-2">
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAnnouncementOpen(true)}
                className="gap-2"
              >
                <Megaphone className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setIsNewChatOpen(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <Tabs value={viewMode} onValueChange={(value) => handleViewModeChange(value as 'chats' | 'announcements' | 'marketplace' | 'hiring' | 'support')} className="mb-3">
          <TabsList className={`grid w-full ${showSupportTab ? 'grid-cols-3' : 'grid-cols-4'} h-10 p-1 gap-1`}>
            <TabsTrigger value="chats" className="h-8 relative" title="Chats">
              <MessageCircle className="h-4 w-4" />
              <ChatTabBadge count={unreadCounts.chats} />
            </TabsTrigger>
            <TabsTrigger value="announcements" className="h-8 relative" title="Announcements">
              <Megaphone className="h-4 w-4" />
              <ChatTabBadge count={unreadCounts.announcements} />
            </TabsTrigger>
            <TabsTrigger value="marketplace" className="h-8 relative" title="Shift Marketplace">
              <ArrowLeftRight className="h-4 w-4" />
              <ChatTabBadge count={unreadCounts.marketplace} />
            </TabsTrigger>
            {!showSupportTab && (
              <TabsTrigger 
                value="hiring" 
                className={`h-8 relative ${!showHiringTab ? 'invisible' : ''}`} 
                title="Hiring"
                disabled={!showHiringTab}
              >
                <Briefcase className="h-4 w-4" />
                <ChatTabBadge count={unreadCounts.hiring} />
              </TabsTrigger>
            )}
          </TabsList>
          {showSupportTab && (
            <TabsList className="grid w-full grid-cols-2 h-10 p-1 gap-1 mt-1">
              <TabsTrigger value="hiring" className="h-8 relative" title="Hiring">
                <Briefcase className="h-4 w-4" />
                <ChatTabBadge count={unreadCounts.hiring} />
              </TabsTrigger>
              <TabsTrigger value="support" className="h-8 relative" title="Support">
                <Headphones className="h-4 w-4" />
                <ChatTabBadge count={unreadCounts.support} />
              </TabsTrigger>
            </TabsList>
          )}
        </Tabs>
        
        <div className="flex-1 overflow-hidden">
          {viewMode === 'support' ? (
            <SupportChatPanel />
          ) : viewMode === 'hiring' ? (
            <HiringChatList
              onSelectConversation={(conv) => setSelectedHiringConversation(conv)}
              selectedId={selectedHiringConversation?.id}
            />
          ) : viewMode !== 'marketplace' && (
            <>
              <div className="mb-2">
                <ChatSearch onSearch={handleSearch} placeholder="Search all chats..." />
              </div>
              <ChatList
                chats={filteredChats}
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
                onTogglePin={handleTogglePin}
                loading={loading}
                searchQuery={searchQuery}
                currentUserId={currentUserId}
              />
            </>
          )}
        </div>
      </div>
      
      {/* Mobile Slide-Over Chat Window */}
      <Sheet 
        open={isMobile && (!!selectedChatId || viewMode === 'marketplace')} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedChatId(null);
            if (viewMode === 'marketplace') {
              setViewMode('chats');
            }
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-full p-0 pt-[env(safe-area-inset-top)] pb-safe">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedChatId(null);
                  if (viewMode === 'marketplace') {
                    setViewMode('chats');
                  }
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold">
                {viewMode === 'marketplace' ? 'Shift Marketplace' : 'Chat'}
              </h2>
            </div>
            <div className="flex-1 overflow-hidden pb-4">
              {(selectedChatId || viewMode === 'marketplace') && (
                <ChatWindow
                  chatId={viewMode === 'marketplace' ? marketplaceChatId : selectedChatId}
                  chatDetails={chats.find(c => c.id === (viewMode === 'marketplace' ? marketplaceChatId : selectedChatId)) || null}
                  onChatDeleted={() => {
                    setSelectedChatId(null);
                    if (viewMode === 'marketplace') {
                      setViewMode('chats');
                    }
                    fetchChats();
                  }}
                  onChatUpdated={fetchChats}
                />
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile Hiring Chat Sheet */}
      <Sheet 
        open={isMobile && viewMode === 'hiring' && !!selectedHiringConversation} 
        onOpenChange={(open) => {
          if (!open) {
            setSelectedHiringConversation(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-full p-0 pt-[env(safe-area-inset-top)] pb-safe">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 p-4 border-b border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedHiringConversation(null);
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold truncate">
                {selectedHiringConversation?.application?.full_name || 'Applicant'}
              </h2>
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedHiringConversation && (
                <HiringChatPanel
                  applicationId={selectedHiringConversation.application_id}
                  applicantName={selectedHiringConversation.application?.full_name || 'Applicant'}
                />
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <NewChatDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onChatCreated={(chatId) => {
          setSelectedChatId(chatId);
          fetchChats();
          setIsNewChatOpen(false);
        }}
        canCreateGroup={isAdmin || isManager}
        locationId={currentLocation?.id}
        locationName={currentLocation?.name}
      />

      <AnnouncementDialog
        open={isAnnouncementOpen}
        onOpenChange={setIsAnnouncementOpen}
        onAnnouncementCreated={(chatId) => {
          setSelectedChatId(chatId);
          fetchChats();
          setIsAnnouncementOpen(false);
        }}
        locationId={currentLocation?.id}
        locationName={currentLocation?.name}
      />

      {marketplaceChatId && (
        <MarketplaceIconSelector
          open={isMarketplaceIconOpen}
          onOpenChange={setIsMarketplaceIconOpen}
          chatId={marketplaceChatId}
          onIconSelected={() => {
            fetchChats();
          }}
        />
      )}

      {/* Floating Support Button for non-super-admin users */}
      <SupportButton />
    </Layout>
  );
}