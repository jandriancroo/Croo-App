import { useRef, useState, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Users, Megaphone, Pin, PinOff, ArrowLeftRight } from 'lucide-react';
import { format, isToday } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const formatLastMessageTime = (dateString: string) => {
  const date = new Date(dateString);
  if (isToday(date)) {
    return format(date, 'h:mm a');
  }
  return format(date, 'MMM d');
};

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
  isPinned?: boolean;
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
  onTogglePin?: (chatId: string, isPinned: boolean) => void;
  loading: boolean;
  searchQuery?: string;
  currentUserId?: string | null;
}

const formatMessagePreview = (content: string): string => {
  // Parse game score messages into friendly format
  if (content?.startsWith("GAME_SCORE:")) {
    const parts = content.replace("GAME_SCORE:", "").split(":");
    if (parts.length >= 3) {
      const gameType = parts[0];
      const score = parts[1];
      const playerName = parts[2];
      const gameNames: Record<string, string> = {
        snake: "Snake",
        marcman: "MarcMan",
        minesweeper: "Minesweeper",
        basketball: "Basketball",
        pizza: "Pizza Paddle"
      };
      const gameName = gameNames[gameType] || gameType;
      return `🎮 ${playerName} scored ${score} in ${gameName}!`;
    }
  }
  // Parse smack talk messages
  if (content?.startsWith("SMACK_TALK:")) {
    const smackText = content.replace("SMACK_TALK:", "");
    return `⚡ ${smackText}`;
  }
  return content;
};

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

// Long press duration in ms
const LONG_PRESS_DURATION = 500;

export function ChatList({ chats, selectedChatId, onSelectChat, onTogglePin, loading, searchQuery, currentUserId }: ChatListProps) {
  const [longPressChat, setLongPressChat] = useState<Chat | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const touchMoved = useRef(false);
  const lastTouchAt = useRef(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((chat: Chat, e: React.TouchEvent) => {
    isLongPress.current = false;
    touchMoved.current = false;
    lastTouchAt.current = Date.now();
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };

    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      setLongPressChat(chat);
    }, LONG_PRESS_DURATION);
  }, []);

  const handleTouchEnd = useCallback((chat: Chat) => {
    lastTouchAt.current = Date.now();
    touchStart.current = null;

    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // Only navigate if it wasn't a long press AND user didn't scroll
    if (!isLongPress.current && !touchMoved.current) {
      onSelectChat(chat.id);
    }

    isLongPress.current = false;
    touchMoved.current = false;
  }, [onSelectChat]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Only treat as scroll if user moved more than a small threshold
    const start = touchStart.current;
    if (!start) return;

    const dx = Math.abs(e.touches[0].clientX - start.x);
    const dy = Math.abs(e.touches[0].clientY - start.y);
    if (dx > 8 || dy > 8) {
      touchMoved.current = true;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
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

  // Separate pinned and unpinned chats
  const pinnedChats = chats.filter(chat => chat.isPinned);
  const unpinnedChats = chats.filter(chat => !chat.isPinned);

  const renderChat = (chat: Chat) => (
    <div
      key={chat.id}
      role="button"
      tabIndex={0}
      // Desktop: click to navigate
      onClick={() => {
        // iOS/Android: a "click" event often fires after a scroll gesture; ignore it
        // if there was a touch interaction very recently.
        if (Date.now() - lastTouchAt.current < 750) return;
        if (!touchMoved.current) {
          onSelectChat(chat.id);
        }
      }}
      // Mobile: use touch events for long-press detection
      onTouchStart={(e) => handleTouchStart(chat, e)}
      onTouchEnd={() => handleTouchEnd(chat)}
      onTouchMove={handleTouchMove}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectChat(chat.id);
        }
      }}
      className={`group w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
        selectedChatId === chat.id
          ? 'bg-accent text-accent-foreground'
          : chat.title === 'Shift Marketplace'
          ? 'bg-accent/15 hover:bg-accent/20 border border-accent/30'
          : chat.isPinned
          ? 'bg-primary/15 hover:bg-primary/20'
          : chat.unreadCount && chat.unreadCount > 0
          ? 'bg-primary/10 hover:bg-primary/15'
          : 'hover:bg-muted'
      }`}
    >
      <Avatar className={`h-12 w-12 flex-shrink-0 ${chat.title === 'Shift Marketplace' ? 'bg-accent/20' : ''}`}>
        {chat.title === 'Shift Marketplace' ? (
          <AvatarFallback className="bg-accent/15">
            <ArrowLeftRight className="h-6 w-6 text-accent" />
          </AvatarFallback>
        ) : chat.is_announcement ? (
          <AvatarFallback className="bg-primary/10">
            <Megaphone className="h-6 w-6 text-primary" />
          </AvatarFallback>
        ) : chat.is_group ? (
          <>
            <AvatarImage src={chat.group_image_url || undefined} />
            <AvatarFallback>
              <Users className="h-6 w-6" />
            </AvatarFallback>
          </>
        ) : (
          <>
            <AvatarImage
              src={
                chat.chat_members?.find((m) => m.user_id !== currentUserId)?.profiles?.profile_photo_url ||
                chat.chat_members?.[0]?.profiles?.profile_photo_url ||
                undefined
              }
            />
            <AvatarFallback className="text-lg font-medium">
              {chat.title?.charAt(0) || 'C'}
            </AvatarFallback>
          </>
        )}
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`flex-1 min-w-0 truncate text-[15px] ${
              chat.unreadCount && chat.unreadCount > 0 ? 'font-bold' : 'font-medium'
            }`}
          >
            {chat.title || (chat.is_group ? 'Group Chat' : 'Direct Message')}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Desktop: show pin button on hover */}
            {onTogglePin && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(chat.id, chat.isPinned || false);
                }}
              >
                {chat.isPinned ? (
                  <PinOff className="h-3 w-3" />
                ) : (
                  <Pin className="h-3 w-3" />
                )}
              </Button>
            )}
            {/* Show pin indicator on mobile for pinned chats */}
            {chat.isPinned && (
              <Pin className="h-3 w-3 text-primary md:hidden" />
            )}
            {chat.unreadCount != null && chat.unreadCount > 0 ? (
              <span className="flex items-center justify-center min-w-5 h-5 px-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-full">
                {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {formatLastMessageTime(chat.updated_at)}
              </span>
            )}
          </div>
        </div>
        {chat.messagePreview && (
          <p className={`text-[14px] truncate mt-1 ${
            chat.unreadCount && chat.unreadCount > 0 
              ? 'text-foreground font-medium' 
              : 'text-muted-foreground'
          }`}>
            {searchQuery ? highlightSearchTerm(formatMessagePreview(chat.messagePreview), searchQuery) : formatMessagePreview(chat.messagePreview)}
          </p>
        )}
      </div>
    </div>
  );

  const getAvatarContent = (chat: Chat) => {
    if (chat.title === 'Shift Marketplace') {
      return (
        <AvatarFallback className="bg-accent/15">
          <ArrowLeftRight className="h-6 w-6 text-accent" />
        </AvatarFallback>
      );
    }
    if (chat.is_announcement) {
      return (
        <AvatarFallback className="bg-primary/10">
          <Megaphone className="h-6 w-6 text-primary" />
        </AvatarFallback>
      );
    }
    if (chat.is_group) {
      return (
        <>
          <AvatarImage src={chat.group_image_url || undefined} />
          <AvatarFallback><Users className="h-6 w-6" /></AvatarFallback>
        </>
      );
    }
    return (
      <>
        <AvatarImage
          src={
            chat.chat_members?.find((m) => m.user_id !== currentUserId)?.profiles?.profile_photo_url ||
            chat.chat_members?.[0]?.profiles?.profile_photo_url ||
            undefined
          }
        />
        <AvatarFallback className="text-lg font-medium">
          {chat.title?.charAt(0) || 'C'}
        </AvatarFallback>
      </>
    );
  };

  const renderPinnedBubble = (chat: Chat) => (
    <button
      key={chat.id}
      onClick={() => onSelectChat(chat.id)}
      onTouchStart={(e) => handleTouchStart(chat, e)}
      onTouchEnd={() => handleTouchEnd(chat)}
      onTouchMove={handleTouchMove}
      className="flex flex-col items-center gap-1 w-[72px] select-none"
    >
      <div className="relative">
        <Avatar className="h-14 w-14">
          {getAvatarContent(chat)}
        </Avatar>
        {chat.unreadCount != null && chat.unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-5 h-5 px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full">
            {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
          </span>
        )}
      </div>
      <span className="text-[11px] font-medium text-center leading-tight line-clamp-2 w-full">
        {chat.title === 'Shift Marketplace' ? 'Shifts' : (chat.title || (chat.is_group ? 'Group' : 'DM'))}
      </span>
    </button>
  );

  return (
    <>
      <div className="overflow-y-auto flex-1">
        {pinnedChats.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 px-3 py-3 justify-center">
              {pinnedChats.map(renderPinnedBubble)}
            </div>
            {unpinnedChats.length > 0 && (
              <div className="mx-3 border-t border-border" />
            )}
          </>
        )}
        {unpinnedChats.length > 0 && (
          <div className="space-y-1">
            {unpinnedChats.map(renderChat)}
          </div>
        )}
      </div>

      {/* Long-press dialog for mobile pin actions */}
      <Dialog open={!!longPressChat} onOpenChange={(open) => !open && setLongPressChat(null)}>
        <DialogContent className="max-w-[280px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-center truncate">
              {longPressChat?.title || 'Chat Options'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            {onTogglePin && longPressChat && (
              <Button
                variant="outline"
                className="w-full gap-2 justify-start"
                onClick={() => {
                  onTogglePin(longPressChat.id, longPressChat.isPinned || false);
                  setLongPressChat(null);
                }}
              >
                {longPressChat.isPinned ? (
                  <>
                    <PinOff className="h-4 w-4" />
                    Unpin Chat
                  </>
                ) : (
                  <>
                    <Pin className="h-4 w-4" />
                    Pin Chat
                  </>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setLongPressChat(null)}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
