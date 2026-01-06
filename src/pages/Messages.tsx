import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowLeft, Megaphone, ArrowLeftRight, Briefcase, MessageCircle } from 'lucide-react';
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
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const isMobile = useIsMobile();
  const showHiringTab = isAdmin || isManager;
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
  const [viewMode, setViewMode] = useState<'chats' | 'announcements' | 'marketplace' | 'hiring'>('chats');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedHiringConversation, setSelectedHiringConversation] = useState<any>(null);

  const fetchChats = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

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
            location_id: currentLocation.id
          })
          .select()
          .single();

        if (newChat) {
          marketplaceChat = newChat;
          
          // Add all users to marketplace chat
          const { data: allUsers } = await supabase
            .from("profiles")
            .select("id");

          if (allUsers) {
            await supabase
              .from("chat_members")
              .insert(allUsers.map(u => ({
                chat_id: newChat.id,
                user_id: u.id
              })));
          }
        }
      }

      // Filter chats by current location
      let query = supabase
        .from('chats')
        .select(`
          *,
          chat_members!inner(
            user_id,
            is_pinned,
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
      const userChats = data?.filter((chat: any) => 
        chat.chat_members.some((member: any) => member.user_id === user.id)
      ) || [];

      // Get unread counts for each chat
      const chatsWithUnread = await Promise.all(
        userChats.map(async (chat: any) => {
          // Get last message in this chat
          const { data: messages } = await supabase
            .from('messages')
            .select('id, created_at, sender_id, content')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: false })
            .limit(1);

          let unreadCount = 0;
          let messagePreview = '';
          let lastMessageTime = chat.updated_at;
          
          if (messages && messages.length > 0) {
            const lastMessage = messages[0];
            messagePreview = lastMessage.content || '';
            lastMessageTime = lastMessage.created_at;
            
            // Only count as unread if last message wasn't sent by current user
            if (lastMessage.sender_id !== user.id) {
              // Check if user has read this message
              const { data: receipt } = await supabase
                .from('message_read_receipts')
                .select('id')
                .eq('message_id', lastMessage.id)
                .eq('user_id', user.id)
                .single();
              
              if (!receipt) {
                unreadCount = 1;
              }
            }
          }

          // For DMs, set title to the other person's name
          if (!chat.is_group && !chat.title) {
            const otherMember = chat.chat_members.find((m: any) => m.user_id !== user.id);
            chat.title = otherMember?.profiles?.full_name || 'Direct Message';
          }

          // Check if current user has pinned this chat
          const currentMember = chat.chat_members.find((m: any) => m.user_id === user.id);
          const isPinned = currentMember?.is_pinned || false;

          return { ...chat, unreadCount, isPinned, messagePreview, updated_at: lastMessageTime };
        })
      );

      // Find and store marketplace chat ID
      const marketplaceItem = chatsWithUnread.find(c => c.title === "Shift Marketplace");
      if (marketplaceItem) {
        setMarketplaceChatId(marketplaceItem.id);
      }

      // Sort chats: pinned first, then unread, then by updated_at (excluding marketplace from regular list)
      const sortedChats = chatsWithUnread
        .filter(c => c.title !== "Shift Marketplace") // Remove marketplace from chat list
        .sort((a, b) => {
          // Pinned chats first
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          
          // Then sort by unread status
          if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
          if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
          
          // If both have same status, sort by updated_at
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });

      setChats(sortedChats);
      setFilteredChats(sortedChats);
      applyViewFilter(sortedChats, viewMode);
    } catch (error: any) {
      console.error('Error fetching chats:', error);
      toast.error('Failed to load chats');
    } finally {
      setLoading(false);
    }
  };

  const applyViewFilter = (chatList: Chat[], mode: 'chats' | 'announcements' | 'marketplace' | 'hiring') => {
    if (mode === 'marketplace' || mode === 'hiring') {
      // Marketplace and Hiring are handled separately
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
      const { data: { user } } = await supabase.auth.getUser();
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

  const handleViewModeChange = (mode: 'chats' | 'announcements' | 'marketplace' | 'hiring') => {
    setViewMode(mode);
    setSearchQuery('');
    setSelectedHiringConversation(null);
    if (mode === 'marketplace' && marketplaceChatId) {
      setSelectedChatId(marketplaceChatId);
    } else if (mode === 'hiring') {
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

    // Subscribe to new messages for real-time updates
    const channel = supabase
      .channel('messages-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        () => {
          fetchChats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentLocation]);

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
          
          <Tabs value={viewMode} onValueChange={(value) => handleViewModeChange(value as 'chats' | 'announcements' | 'marketplace' | 'hiring')} className="mb-4">
            <TabsList className="grid w-full grid-cols-4 h-10 p-1 gap-1">
              <TabsTrigger value="chats" className="h-8" title="Chats">
                <MessageCircle className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="announcements" className="h-8" title="Announcements">
                <Megaphone className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="marketplace" className="h-8" title="Shift Marketplace">
                <ArrowLeftRight className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger 
                value="hiring" 
                className={`h-8 ${!showHiringTab ? 'invisible' : ''}`} 
                title="Hiring"
                disabled={!showHiringTab}
              >
                <Briefcase className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          
          {viewMode === 'hiring' ? (
            <HiringChatList
              onSelectConversation={(conv) => setSelectedHiringConversation(conv)}
              selectedId={selectedHiringConversation?.id}
            />
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
        <div className="flex-1 bg-card rounded-lg flex min-w-0">
          {viewMode === 'hiring' && selectedHiringConversation ? (
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
        
        <Tabs value={viewMode} onValueChange={(value) => handleViewModeChange(value as 'chats' | 'announcements' | 'marketplace' | 'hiring')} className="mb-3">
          <TabsList className="grid w-full grid-cols-4 h-10 p-1 gap-1">
            <TabsTrigger value="chats" className="h-8" title="Chats">
              <MessageCircle className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="announcements" className="h-8" title="Announcements">
              <Megaphone className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="marketplace" className="h-8" title="Shift Marketplace">
              <ArrowLeftRight className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger 
              value="hiring" 
              className={`h-8 ${!showHiringTab ? 'invisible' : ''}`} 
              title="Hiring"
              disabled={!showHiringTab}
            >
              <Briefcase className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex-1 overflow-hidden">
          {viewMode === 'hiring' ? (
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
    </Layout>
  );
}