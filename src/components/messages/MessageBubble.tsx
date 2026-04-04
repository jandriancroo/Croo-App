import { useState, useCallback, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { getDisplayName, getInitials } from '@/utils/displayName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MessageSquare, File, Clock, Trash2, ImageIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MessageContent } from './MessageContent';
import { ReactionPicker } from './ReactionPicker';
import { MessageReactions } from './MessageReactions';
import { ReadReceipts } from './ReadReceipts';
import { LazyImage } from './LazyImage';


interface ParentMessageData {
  content: string | null;
  profiles: {
    full_name: string;
  } | null;
}

interface Message {
  id: string;
  content: string | null;
  sender_id: string;
  attachment_url: string | null;
  attachment_type: string | null;
  created_at: string;
  scheduled_at: string | null;
  parent_message_id: string | null;
  is_deleted_for_everyone?: boolean;
  profiles?: {
    full_name: string;
    profile_photo_url: string | null;
  };
  parent_message?: ParentMessageData[] | ParentMessageData | null;
  isPending?: boolean;
  isNew?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  showAvatar: boolean;
  showName: boolean;
  isFirstInCluster: boolean;
  isLastInCluster: boolean;
  chatId: string;
  currentUserId: string | null;
  isAnnouncement: boolean;
  isGroupChat: boolean;
  canUnsend?: boolean;
  signedAttachmentUrl?: string;
  onReaction: (messageId: string, reaction: string) => void;
  onReply: (message: Message) => void;
  onImageClick: (url: string) => void;
  onUnsend?: (messageId: string) => void;
  sending: boolean;
}

export function MessageBubble({
  message,
  isOwnMessage,
  showAvatar,
  showName,
  isFirstInCluster,
  isLastInCluster,
  chatId,
  currentUserId,
  isAnnouncement,
  isGroupChat,
  canUnsend = false,
  signedAttachmentUrl,
  onReaction,
  onReply,
  onImageClick,
  onUnsend,
  sending,
}: MessageBubbleProps) {
  const isPending = message.isPending;
  const isDeleted = message.is_deleted_for_everyone;
  const markedRef = useRef<string | null>(null);

  // Long-press for mobile message actions
  const [showMobileActions, setShowMobileActions] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isPending || isDeleted || isAnnouncement) return;
    touchMovedRef.current = false;
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      if (!touchMovedRef.current) {
        setShowMobileActions(true);
      }
    }, 500);
  }, [isPending, isDeleted, isAnnouncement]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = Math.abs(e.touches[0].clientX - touchStartRef.current.x);
    const dy = Math.abs(e.touches[0].clientY - touchStartRef.current.y);
    if (dx > 8 || dy > 8) {
      touchMovedRef.current = true;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartRef.current = null;
  }, []);

  // Mark message as read for non-sender users
  useEffect(() => {
    if (!currentUserId || message.sender_id === currentUserId || isPending) return;
    if (markedRef.current === message.id) return;
    markedRef.current = message.id;

    supabase
      .from('message_read_receipts')
      .insert({ message_id: message.id, user_id: currentUserId })
      .then(({ error }) => {
        if (error && !error.message?.includes('duplicate')) {
          console.error('Error marking as read:', error);
        }
      });
  }, [message.id, currentUserId, message.sender_id, isPending]);

  // Determine if image is old (>24h) and has no signed URL yet
  const SIGNED_URL_AGE_LIMIT_MS = 24 * 60 * 60 * 1000;
  const msgAge = Date.now() - new Date(message.created_at).getTime();
  const isOldAttachment = msgAge > SIGNED_URL_AGE_LIMIT_MS && message.attachment_type?.startsWith('image/') && !signedAttachmentUrl;
  
  const [onDemandUrl, setOnDemandUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  const loadOnDemand = useCallback(async () => {
    if (!message.attachment_url || loadingUrl) return;
    setLoadingUrl(true);
    const match = message.attachment_url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
    if (match) {
      const { data } = await supabase.storage
        .from(match[1])
        .createSignedUrl(decodeURIComponent(match[2]), 60 * 60);
      if (data?.signedUrl) setOnDemandUrl(data.signedUrl);
    }
    setLoadingUrl(false);
  }, [message.attachment_url, loadingUrl]);

  const displayUrl = isDeleted ? null : (onDemandUrl || signedAttachmentUrl || (isOldAttachment ? null : message.attachment_url));

  const bubbleTailClass = isLastInCluster
    ? isOwnMessage
      ? 'bubble-tail-right'
      : 'bubble-tail-left'
    : '';

  const clusterSpacing = isFirstInCluster ? 'mt-3' : 'mt-0.5';

  if (isDeleted) {
    return (
      <div className={`flex gap-2 ${isOwnMessage ? 'flex-row-reverse' : ''} ${clusterSpacing}`}>
        <div className="w-8 flex-shrink-0" />
        <div className={`flex flex-col min-w-0 max-w-[75%] ${isOwnMessage ? 'items-end' : ''}`}>
          <div className="rounded-2xl px-3 py-2 bg-muted/50 border border-border/50 italic text-muted-foreground text-sm">
            🚫 This message was removed
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 ${isOwnMessage ? 'flex-row-reverse' : ''} ${clusterSpacing}`}>
      <div className="w-8 flex-shrink-0">
        {showAvatar && !isOwnMessage && (
          <Avatar className="h-8 w-8">
            <AvatarImage src={message.profiles?.profile_photo_url || undefined} />
            <AvatarFallback className="text-xs">
              {getInitials(getDisplayName(message.profiles?.full_name, (message.profiles as any)?.nickname))}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div
        className={`flex flex-col min-w-0 ${isAnnouncement ? 'max-w-[90%]' : 'max-w-[75%]'} overflow-hidden ${isOwnMessage ? 'items-end' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {showName && isFirstInCluster && (
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground">
              {isPending ? 'You' : getDisplayName(message.profiles?.full_name, (message.profiles as any)?.nickname) || 'Unknown'}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              {isPending ? 'Sending...' : format(new Date(message.created_at), 'h:mm a')}
            </span>
            {message.scheduled_at && isOwnMessage && (
              <span className="text-[10px] text-amber-500 flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {format(new Date(message.scheduled_at), 'MMM d, h:mm a')}
              </span>
            )}
          </div>
        )}

        <div className="relative">
          <div
            className={`
              rounded-2xl px-3 py-2 relative
              ${isOwnMessage 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted'
              }
              ${isLastInCluster && isOwnMessage ? 'rounded-br-sm' : ''}
              ${isLastInCluster && !isOwnMessage ? 'rounded-bl-sm' : ''}
              ${isPending ? 'opacity-70' : ''}
              ${bubbleTailClass}
            `}
          >
            {isPending && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-foreground/20 rounded-b-lg overflow-hidden">
                <div className="h-full bg-primary-foreground/60 animate-pulse" style={{ width: '60%' }} />
              </div>
            )}

            {message.parent_message && (() => {
              const parent = Array.isArray(message.parent_message)
                ? message.parent_message[0]
                : message.parent_message;
              if (!parent) return null;
              return (
                <div className={`mb-2 p-2 rounded text-xs border-l-2 ${
                  isOwnMessage
                    ? 'bg-primary-foreground/10 border-primary-foreground/50'
                    : 'bg-background/50 border-primary/50'
                }`}>
                  <p className={`font-medium mb-0.5 ${isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {getDisplayName(parent.profiles?.full_name, (parent.profiles as any)?.nickname) || 'Unknown'}
                  </p>
                  <p className={`line-clamp-1 ${isOwnMessage ? 'text-primary-foreground/80' : 'text-foreground/70'}`}>
                    {parent.content || 'Attachment'}
                  </p>
                </div>
              );
            })()}

            {isOldAttachment && !onDemandUrl ? (
              <button
                onClick={loadOnDemand}
                className="rounded-lg w-[180px] h-[120px] bg-muted/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/80 active:bg-muted transition-colors"
              >
                {loadingUrl ? (
                  <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                ) : (
                  <>
                    <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
                    <span className="text-xs text-muted-foreground/70">Tap to load</span>
                  </>
                )}
              </button>
            ) : displayUrl ? (
              <div className="mb-1">
                {message.attachment_type?.startsWith('image/') ? (
                  <LazyImage
                    src={displayUrl}
                    alt="Attachment"
                    className="rounded-lg max-w-[240px] cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => onImageClick(displayUrl)}
                  />
                ) : (
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <File className="h-4 w-4" />
                    {message.content || 'Attachment'}
                  </a>
                )}
              </div>
            ) : null}

            {message.content && (
              <div className="text-[15px] leading-relaxed">
                <MessageContent
                  content={message.content}
                  chatId={chatId}
                  senderName={message.profiles?.full_name}
                />
              </div>
            )}
          </div>

          {isOwnMessage && isLastInCluster && !isPending && (
            <div className="flex justify-end mt-0.5 pr-1">
              <ReadReceipts
                messageId={message.id}
                senderId={message.sender_id}
                currentUserId={currentUserId}
                chatId={chatId}
              />
            </div>
          )}
        </div>

        {/* Desktop hover actions */}
        {!isAnnouncement && !isPending && isLastInCluster && (
          <>
            <div className="hidden sm:flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <ReactionPicker onSelect={(reaction) => onReaction(message.id, reaction)} />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => onReply(message)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              {canUnsend && onUnsend && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => onUnsend(message.id)}
                  title="Delete for everyone"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <MessageReactions messageId={message.id} currentUserId={currentUserId} />
          </>
        )}

        {/* Mobile long-press actions overlay */}
        {showMobileActions && !isAnnouncement && !isPending && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowMobileActions(false)}>
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-sm mx-4 mb-8 bg-popover rounded-2xl shadow-xl border border-border overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Quick reactions row */}
              <div className="flex items-center justify-center gap-3 px-4 py-3 border-b border-border">
                {['👍', '❤️', '😂', '😮', '😢', '🔥'].map((emoji) => (
                  <button
                    key={emoji}
                    className="text-2xl hover:scale-125 active:scale-110 transition-transform"
                    onClick={() => {
                      onReaction(message.id, emoji);
                      setShowMobileActions(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              
              {/* Action buttons */}
              <button
                className="w-full px-4 py-3.5 text-left text-sm font-medium flex items-center gap-3 hover:bg-accent active:bg-accent transition-colors"
                onClick={() => {
                  onReply(message);
                  setShowMobileActions(false);
                }}
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                Reply
              </button>
              
              {canUnsend && onUnsend && (
                <button
                  className="w-full px-4 py-3.5 text-left text-sm font-medium flex items-center gap-3 text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
                  onClick={() => {
                    onUnsend(message.id);
                    setShowMobileActions(false);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete for everyone
                </button>
              )}

              <button
                className="w-full px-4 py-3.5 text-left text-sm text-muted-foreground font-medium border-t border-border hover:bg-accent active:bg-accent transition-colors"
                onClick={() => setShowMobileActions(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Mobile: always show reactions if any exist */}
        {!isAnnouncement && !isPending && !isLastInCluster && (
          <MessageReactions messageId={message.id} currentUserId={currentUserId} />
        )}
      </div>
    </div>
  );
}
