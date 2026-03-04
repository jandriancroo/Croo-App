import { memo } from 'react';
import { MessageBubble } from './MessageBubble';

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

interface MemoizedMessageBubbleProps {
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

export const MemoizedMessageBubble = memo(
  function MemoizedMessageBubble(props: MemoizedMessageBubbleProps) {
    return <MessageBubble {...props} />;
  },
  (prevProps, nextProps) => {
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (prevProps.message.isPending !== nextProps.message.isPending) return false;
    if (prevProps.message.isNew !== nextProps.message.isNew) return false;
    if (prevProps.message.is_deleted_for_everyone !== nextProps.message.is_deleted_for_everyone) return false;
    if (prevProps.signedAttachmentUrl !== nextProps.signedAttachmentUrl) return false;
    if (prevProps.isFirstInCluster !== nextProps.isFirstInCluster) return false;
    if (prevProps.isLastInCluster !== nextProps.isLastInCluster) return false;
    if (prevProps.showAvatar !== nextProps.showAvatar) return false;
    if (prevProps.showName !== nextProps.showName) return false;
    if (prevProps.sending !== nextProps.sending) return false;
    if (prevProps.canUnsend !== nextProps.canUnsend) return false;
    if (prevProps.message.profiles?.full_name !== nextProps.message.profiles?.full_name) return false;
    if (prevProps.message.profiles?.profile_photo_url !== nextProps.message.profiles?.profile_photo_url) return false;
    return true;
  }
);
