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
  isArcadeChat: boolean;
  smackTalks?: { text: string; senderName: string }[];
  signedAttachmentUrl?: string;
  onReaction: (messageId: string, reaction: string) => void;
  onReply: (message: Message) => void;
  onSmackTalk: (text: string, messageId?: string) => void;
  onImageClick: (url: string) => void;
  sending: boolean;
}

/**
 * Memoized MessageBubble component to prevent unnecessary re-renders.
 * 
 * Performance comparison:
 * - Without memo: Every state change in ChatWindow (typing, new messages) 
 *   causes ALL message bubbles to re-render
 * - With memo: Only bubbles with changed props re-render
 * 
 * Expected improvement: ~60-80% reduction in render time for large chats
 */
export const MemoizedMessageBubble = memo(
  function MemoizedMessageBubble(props: MemoizedMessageBubbleProps) {
    return <MessageBubble {...props} />;
  },
  (prevProps, nextProps) => {
    // Custom comparison for optimal memoization
    // Only re-render if these specific props change:
    
    // Message content/state changes
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (prevProps.message.isPending !== nextProps.message.isPending) return false;
    if (prevProps.message.isNew !== nextProps.message.isNew) return false;
    
    // Attachment changes
    if (prevProps.signedAttachmentUrl !== nextProps.signedAttachmentUrl) return false;
    
    // Cluster position changes (affects bubble shape)
    if (prevProps.isFirstInCluster !== nextProps.isFirstInCluster) return false;
    if (prevProps.isLastInCluster !== nextProps.isLastInCluster) return false;
    if (prevProps.showAvatar !== nextProps.showAvatar) return false;
    if (prevProps.showName !== nextProps.showName) return false;
    
    // Smack talks on game scores
    if (prevProps.smackTalks?.length !== nextProps.smackTalks?.length) return false;
    
    // Sending state only matters for actions
    if (prevProps.sending !== nextProps.sending) return false;
    
    // Profile updates (background fetch)
    if (prevProps.message.profiles?.full_name !== nextProps.message.profiles?.full_name) return false;
    if (prevProps.message.profiles?.profile_photo_url !== nextProps.message.profiles?.profile_photo_url) return false;
    
    // All checks passed - props are equal, skip re-render
    return true;
  }
);
