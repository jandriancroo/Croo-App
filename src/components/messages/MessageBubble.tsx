import { format } from 'date-fns';
import { getDisplayName, getInitials } from '@/utils/displayName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MessageSquare, File, Clock, Trash2 } from 'lucide-react';
import { MessageContent } from './MessageContent';
import { ReactionPicker } from './ReactionPicker';
import { MessageReactions } from './MessageReactions';
import { ReadReceipts } from './ReadReceipts';
import { SmackTalkPicker } from './SmackTalkPicker';
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
  isArcadeChat: boolean;
  isGroupChat: boolean;
  canUnsend?: boolean;
  smackTalks?: { text: string; senderName: string }[];
  signedAttachmentUrl?: string;
  onReaction: (messageId: string, reaction: string) => void;
  onReply: (message: Message) => void;
  onSmackTalk: (text: string, messageId?: string) => void;
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
  isArcadeChat,
  isGroupChat,
  smackTalks = [],
  signedAttachmentUrl,
  onReaction,
  onReply,
  onSmackTalk,
  onImageClick,
  sending,
}: MessageBubbleProps) {
  const isPending = message.isPending;
  const displayUrl = signedAttachmentUrl || message.attachment_url;

  // Bubble tail class - only show on last message of cluster
  const bubbleTailClass = isLastInCluster
    ? isOwnMessage
      ? 'bubble-tail-right'
      : 'bubble-tail-left'
    : '';

  // Cluster spacing - tighter for same sender
  const clusterSpacing = isFirstInCluster ? 'mt-3' : 'mt-0.5';

  return (
    <div className={`flex gap-2 ${isOwnMessage ? 'flex-row-reverse' : ''} ${clusterSpacing}`}>
      {/* Avatar - only show on last message of cluster for non-own messages */}
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

      <div className={`flex flex-col min-w-0 max-w-[75%] overflow-hidden ${isOwnMessage ? 'items-end' : ''}`}>
        {/* Name and time - only on first message of cluster */}
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

        {/* Bubble */}
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
              ${message.content?.startsWith('GAME_SCORE:') ? 'overflow-visible' : ''}
              ${isPending ? 'opacity-70' : ''}
              ${bubbleTailClass}
            `}
          >
            {/* Sending indicator */}
            {isPending && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-foreground/20 rounded-b-lg overflow-hidden">
                <div className="h-full bg-primary-foreground/60 animate-pulse" style={{ width: '60%' }} />
              </div>
            )}

            {/* Reply reference */}
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

            {/* Attachment - uses LazyImage for performance */}
            {displayUrl && (
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
            )}

            {/* Message content */}
            {message.content && (
              <div className="text-[15px] leading-relaxed">
                <MessageContent
                  content={message.content}
                  chatId={chatId}
                  senderName={message.profiles?.full_name}
                  smackTalks={smackTalks}
                />
              </div>
            )}
          </div>

          {/* Delivery status for own messages - only in 1:1 chats */}
          {isOwnMessage && isLastInCluster && !isPending && !isGroupChat && (
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

        {/* Reactions & Actions - only show on last message or when not an announcement */}
        {!isAnnouncement && !isPending && isLastInCluster && (
          <>
            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <ReactionPicker onSelect={(reaction) => onReaction(message.id, reaction)} />
              {isArcadeChat && message.content?.startsWith('GAME_SCORE:') && (
                <SmackTalkPicker onSelect={(text) => onSmackTalk(text, message.id)} disabled={sending} />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => onReply(message)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
            </div>
            <MessageReactions messageId={message.id} currentUserId={currentUserId} />
          </>
        )}
      </div>
    </div>
  );
}
