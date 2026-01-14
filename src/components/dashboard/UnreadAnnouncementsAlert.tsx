import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Megaphone, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';

interface UnreadAnnouncement {
  chatId: string;
  title: string;
  preview: string;
  createdAt: string;
}

export function UnreadAnnouncementsAlert() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: unreadAnnouncements = [] } = useQuery({
    queryKey: ['unread-announcements-dashboard', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Get all announcement chats user is a member of
      const { data: memberChats, error: memberError } = await supabase
        .from('chat_members')
        .select(`
          chat_id,
          chats!inner(
            id,
            title,
            is_announcement,
            created_at,
            messages(content, created_at)
          )
        `)
        .eq('user_id', user.id)
        .eq('chats.is_announcement', true);

      if (memberError) {
        console.error('Error fetching announcement memberships:', memberError);
        return [];
      }

      if (!memberChats || memberChats.length === 0) return [];

      const chatIds = memberChats.map(m => m.chat_id);

      // Get which announcements user has read
      const { data: reads, error: readsError } = await supabase
        .from('announcement_reads')
        .select('chat_id')
        .eq('user_id', user.id)
        .in('chat_id', chatIds);

      if (readsError) {
        console.error('Error fetching announcement reads:', readsError);
        return [];
      }

      const readChatIds = new Set(reads?.map(r => r.chat_id) || []);

      // Filter to unread announcements
      const unread: UnreadAnnouncement[] = memberChats
        .filter(m => !readChatIds.has(m.chat_id))
        .map(m => {
          const chat = m.chats as any;
          const messages = chat.messages || [];
          const latestMessage = messages.sort((a: any, b: any) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          
          return {
            chatId: chat.id,
            title: chat.title || 'Announcement',
            preview: latestMessage?.content?.substring(0, 80) || '',
            createdAt: latestMessage?.created_at || chat.created_at,
          };
        })
        // Sort by most recent first
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        // Limit to 3 most recent
        .slice(0, 3);

      return unread;
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000, // 30s cache
    refetchInterval: 60 * 1000, // Refetch every minute
  });

  if (unreadAnnouncements.length === 0) return null;

  return (
    <>
      {unreadAnnouncements.map((announcement) => (
        <Card
          key={announcement.chatId}
          className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-amber-500 bg-amber-500/5"
          onClick={() => navigate(`/messages?chat=${announcement.chatId}`)}
        >
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Megaphone className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{announcement.title}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {formatDistanceToNow(new Date(announcement.createdAt), { addSuffix: true })}
                </span>
              </div>
              {announcement.preview && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {announcement.preview}...
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
