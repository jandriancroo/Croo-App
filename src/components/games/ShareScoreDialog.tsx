import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Users, Megaphone } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement: boolean;
  group_image_url: string | null;
}

interface ShareScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameType: 'snake' | 'minesweeper' | 'basketball';
  score: number;
}

export function ShareScoreDialog({ open, onOpenChange, gameType, score }: ShareScoreDialogProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchChats();
    }
  }, [open]);

  const fetchChats = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get chats the user is a member of
      const { data: memberChats, error } = await supabase
        .from('chat_members')
        .select(`
          chat_id,
          chats!inner(id, title, is_group, is_announcement, group_image_url)
        `)
        .eq('user_id', user.id);

      if (error) throw error;

      // Filter out announcements and format the data
      const formattedChats = (memberChats || [])
        .map((mc: any) => mc.chats)
        .filter((chat: Chat) => !chat.is_announcement);

      setChats(formattedChats);
    } catch (error) {
      console.error('Error fetching chats:', error);
      toast.error('Failed to load chats');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (chatId: string) => {
    setSending(chatId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get user's name for the message
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const playerName = profile?.full_name || 'Someone';

      // Send message with special game score format
      // Format: GAME_SCORE:gameType:score:playerName
      const content = `GAME_SCORE:${gameType}:${score}:${playerName}`;

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
          content,
        });

      if (error) throw error;

      // Send push notifications to chat members
      try {
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId)
          .neq('user_id', user.id);

        if (members && members.length > 0) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              title: `${playerName} scored!`,
              body: `${score.toLocaleString()} pts in ${gameType === 'snake' ? 'Snake' : 'Minesweeper'}`,
              notification_type: 'chat_messages',
              data: { chat_id: chatId, type: 'message' }
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
      }

      toast.success('Score shared!');
      onOpenChange(false);
    } catch (error) {
      console.error('Error sharing score:', error);
      toast.error('Failed to share score');
    } finally {
      setSending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share Your Score</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-4">
            Brag about your <span className="font-semibold text-primary">{score.toLocaleString()} pts</span> in {
              gameType === 'snake' ? 'Snake' : gameType === 'minesweeper' ? 'Minesweeper' : 'Hoops'
            }!
          </p>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading chats...
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No chats available
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-2">
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => handleShare(chat.id)}
                    disabled={sending !== null}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={chat.group_image_url || undefined} />
                      <AvatarFallback>
                        {chat.is_group ? (
                          <Users className="h-5 w-5" />
                        ) : (
                          chat.title?.charAt(0) || 'C'
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-left truncate font-medium">
                      {chat.title || 'Chat'}
                    </span>
                    {sending === chat.id ? (
                      <span className="text-xs text-muted-foreground">Sending...</span>
                    ) : (
                      <Send className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
