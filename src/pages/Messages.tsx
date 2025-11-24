import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowLeft } from 'lucide-react';
import { ChatList } from '@/components/messages/ChatList';
import { ChatWindow } from '@/components/messages/ChatWindow';
import { NewChatDialog } from '@/components/messages/NewChatDialog';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Drawer, DrawerContent } from '@/components/ui/drawer';

interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  group_image_url: string | null;
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
  const [loading, setLoading] = useState(true);
  const [showChatList, setShowChatList] = useState(true);

  const fetchChats = async () => {
    try {
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const userChats = data?.filter((chat: any) => 
        chat.chat_members.some((member: any) => member.user_id === user.id)
      ).map((chat: any) => {
        // For DMs, set title to the other person's name
        if (!chat.is_group && !chat.title) {
          const otherMember = chat.chat_members.find((m: any) => m.user_id !== user.id);
          chat.title = otherMember?.profiles?.full_name || 'Direct Message';
        }
        return chat;
      }) || [];

      setChats(userChats);
    } catch (error: any) {
      console.error('Error fetching chats:', error);
      toast.error('Failed to load chats');
    } finally {
      setLoading(false);
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
              <h2 className="text-lg font-semibold">Messages</h2>
              <Button
                size="sm"
                onClick={() => setIsNewChatOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                New
              </Button>
            </div>
            <ChatList
              chats={chats}
              selectedChatId={selectedChatId}
              onSelectChat={setSelectedChatId}
              loading={loading}
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
                <h2 className="text-lg font-semibold">Messages</h2>
                <Button
                  size="sm"
                  onClick={() => setIsNewChatOpen(true)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              </div>
              <ChatList
                chats={chats}
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
                loading={loading}
              />
            </div>
            
            {/* Mobile Slide-Over Chat Window */}
            <Drawer open={!!selectedChatId} onOpenChange={(open) => !open && setSelectedChatId(null)}>
              <DrawerContent className="h-[95vh]">
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-2 p-4 border-b border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedChatId(null)}
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
    </Layout>
  );
}