import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowLeft, Megaphone } from 'lucide-react';
import { ChatList } from '@/components/messages/ChatList';
import { ChatWindow } from '@/components/messages/ChatWindow';
import { NewChatDialog } from '@/components/messages/NewChatDialog';
import { AnnouncementDialog } from '@/components/messages/AnnouncementDialog';
import { MarketplaceIconSelector } from '@/components/messages/MarketplaceIconSelector';
import { ChatSearch } from '@/components/messages/ChatSearch';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Drawer, DrawerContent } from '@/components/ui/drawer';

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
  chat_members: Array<{
    user_id: string;
    profiles: {
      id: string;
      full_name: string;
      profile_photo_url: string | null;
    };
  }>;
}

export default function Messages() {
  const { isAdmin, isManager } = useUserRole();
  const isMobile = useIsMobile();
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

  const fetchChats = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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
      if (!marketplaceChat) {
        const { data: newChat } = await supabase
          .from("chats")
          .insert({
            created_by: user.id,
            is_group: true,
            title: "Shift Marketplace"
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

      const { data, error } = await supabase
        .from('chats')
        .select(`
          *,
          chat_members!inner(
            user_id,
            profiles(id, full_name, profile_photo_url)
          )
        `)
        .order('updated_at', { ascending: false });

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
            .select('id, created_at, sender_id')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: false })
            .limit(1);

          let unreadCount = 0;
          
          if (messages && messages.length > 0) {
            const lastMessage = messages[0];
            
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

          return { ...chat, unreadCount };
        })
      );

      // Sort chats: Shift Marketplace first, then unread chats, then by updated_at
      const sortedChats = chatsWithUnread.sort((a, b) => {
        if (a.title === "Shift Marketplace") {
          // Store marketplace chat ID for icon selector
          setMarketplaceChatId(a.id);
          return -1;
        }
        if (b.title === "Shift Marketplace") {
          setMarketplaceChatId(b.id);
          return 1;
        }
        
        // Sort by unread status
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
        if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
        
        // If both have same unread status, sort by updated_at
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });

      setChats(sortedChats);
      setFilteredChats(sortedChats);
    } catch (error: any) {
      console.error('Error fetching chats:', error);
      toast.error('Failed to load chats');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setFilteredChats(chats);
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

      // Filter chats to only those with matching messages or matching titles
      const filtered = chats
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

  useEffect(() => {
    fetchChats();

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
  }, []);

  return (
    <Layout>
      <div className="flex h-[calc(100vh-12rem)] gap-4">
        {/* Desktop: Chat List Sidebar */}
        {!isMobile && (
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
            <div className="mb-4">
              <ChatSearch onSearch={handleSearch} placeholder="Search all chats..." />
            </div>
            <ChatList
              chats={filteredChats}
              selectedChatId={selectedChatId}
              onSelectChat={setSelectedChatId}
              loading={loading}
              searchQuery={searchQuery}
            />
          </div>
        )}

        {/* Desktop: Chat Window */}
        {!isMobile && (
          <div className="flex-1 bg-card rounded-lg">
            {selectedChatId ? (
              <ChatWindow
                chatId={selectedChatId}
                chatDetails={chats.find(c => c.id === selectedChatId) || null}
                onChatDeleted={() => {
                  setSelectedChatId(null);
                  fetchChats();
                }}
                onChatUpdated={fetchChats}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select a chat to start messaging</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile: Chat List and Slide-Over Chat Window */}
        {isMobile && (
          <>
            <div className="flex-1 bg-card rounded-lg p-4 flex flex-col">
              <div className="flex items-center justify-between mb-4">
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
              <div className="mb-4">
                <ChatSearch onSearch={handleSearch} placeholder="Search all chats..." />
              </div>
              <ChatList
                chats={filteredChats}
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
                loading={loading}
                searchQuery={searchQuery}
              />
            </div>
            
            {/* Mobile Slide-Over Chat Window */}
            <Drawer 
              open={!!selectedChatId} 
              onOpenChange={(open) => {
                if (!open) {
                  setSelectedChatId(null);
                }
              }}
              modal={true}
              dismissible={true}
            >
              <DrawerContent className="h-[95vh]">
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedChatId(null);
                      }}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">Chat</h2>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    {selectedChatId && (
                      <ChatWindow
                        chatId={selectedChatId}
                        chatDetails={chats.find(c => c.id === selectedChatId) || null}
                        onChatDeleted={() => {
                          setSelectedChatId(null);
                          fetchChats();
                        }}
                        onChatUpdated={fetchChats}
                      />
                    )}
                  </div>
                </div>
              </DrawerContent>
            </Drawer>
          </>
        )}
      </div>

      <NewChatDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onChatCreated={(chatId) => {
          setSelectedChatId(chatId);
          fetchChats();
          setIsNewChatOpen(false);
        }}
        canCreateGroup={isAdmin || isManager}
      />

      <AnnouncementDialog
        open={isAnnouncementOpen}
        onOpenChange={setIsAnnouncementOpen}
        onAnnouncementCreated={(chatId) => {
          setSelectedChatId(chatId);
          fetchChats();
          setIsAnnouncementOpen(false);
        }}
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