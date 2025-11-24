import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Users } from 'lucide-react';

interface Chat {
  id: string;
  title: string | null;
  is_group: boolean;
  created_at: string;
  updated_at: string;
}

interface ChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  loading: boolean;
}

export function ChatList({ chats, selectedChatId, onSelectChat, loading }: ChatListProps) {
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
              : 'hover:bg-muted'
          }`}
        >
          <Avatar className="h-10 w-10">
            {chat.is_group ? (
              <div className="bg-primary text-primary-foreground h-full w-full flex items-center justify-center">
                <Users className="h-5 w-5" />
              </div>
            ) : (
              <>
                <AvatarImage src={undefined} />
                <AvatarFallback>
                  {chat.title?.charAt(0) || 'C'}
                </AvatarFallback>
              </>
            )}
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">
              {chat.title || (chat.is_group ? 'Group Chat' : 'Direct Message')}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {new Date(chat.updated_at).toLocaleDateString()}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}