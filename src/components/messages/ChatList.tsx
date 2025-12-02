import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Megaphone } from 'lucide-react';

interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement?: boolean;
  created_at: string;
  updated_at: string;
  group_image_url: string | null;
  unreadCount?: number;
  messagePreview?: string;
  chat_members?: Array<{
    user_id: string;
    profiles: {
      profile_photo_url: string | null;
    };
  }>;
}

interface ChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  loading: boolean;
  searchQuery?: string;
  currentUserId?: string | null;
}

const highlightSearchTerm = (text: string, searchQuery: string) => {
  if (!searchQuery) return text;
  
  const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
  return parts.map((part, index) =>
    part.toLowerCase() === searchQuery.toLowerCase() ? (
      <mark key={index} className="bg-yellow-300 text-foreground font-semibold">
        {part}
      </mark>
    ) : (
      part
    )
  );
};

export function ChatList({ chats, selectedChatId, onSelectChat, loading, searchQuery, currentUserId }: ChatListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
        <p>No chats yet</p>
        <p className="text-xs mt-1">Click "New" to start a conversation</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 overflow-y-auto flex-1">
      {chats.map((chat) => (
        <button
          key={chat.id}
          onClick={() => onSelectChat(chat.id)}
          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
            selectedChatId === chat.id
              ? 'bg-accent text-accent-foreground'
              : chat.unreadCount && chat.unreadCount > 0
              ? 'bg-primary/5 hover:bg-primary/10'
              : 'hover:bg-muted'
          }`}
        >
          <Avatar className="h-10 w-10">
            {chat.is_announcement ? (
              <AvatarFallback className="bg-primary/10">
                <Megaphone className="h-5 w-5 text-primary" />
              </AvatarFallback>
            ) : chat.is_group ? (
              <>
                <AvatarImage src={chat.group_image_url || undefined} />
                <AvatarFallback>
                  <Users className="h-5 w-5" />
                </AvatarFallback>
              </>
            ) : (
              <>
                <AvatarImage src={
                  // For DM chats, show the OTHER person's photo (not the logged-in user)
                  chat.chat_members?.find(m => m.user_id !== currentUserId)?.profiles?.profile_photo_url || 
                  chat.chat_members?.[0]?.profiles?.profile_photo_url || 
                  undefined
                } />
                <AvatarFallback>
                  {chat.title?.charAt(0) || 'C'}
                </AvatarFallback>
              </>
            )}
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className={`truncate ${
                chat.unreadCount && chat.unreadCount > 0 ? 'font-bold' : 'font-medium'
              }`}>
                {chat.title || (chat.is_group ? 'Group Chat' : 'Direct Message')}
              </p>
              {chat.unreadCount && chat.unreadCount > 0 && (
                <span className="flex-shrink-0 bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {chat.unreadCount}
                </span>
              )}
            </div>
            {chat.messagePreview && searchQuery ? (
              <p className="text-xs text-muted-foreground truncate mt-1">
                {highlightSearchTerm(chat.messagePreview, searchQuery)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground truncate">
                {new Date(chat.updated_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}