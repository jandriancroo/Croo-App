import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { markChatAsRead } from '@/hooks/useUnreadMessages';
import { Button } from '@/components/ui/button';
import { MentionInput } from './MentionInput';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Paperclip, File, Settings, MessageSquare, Trash2, Megaphone, Users, Loader2 } from 'lucide-react';
import { GifPicker } from './GifPicker';
import { toast } from 'sonner';
import { format, isSameDay } from 'date-fns';
import { ReactionPicker } from './ReactionPicker';
import { MessageReactions } from './MessageReactions';
import { GroupSettingsDialog } from './GroupSettingsDialog';
import { MessageContent } from './MessageContent';
import { ReadReceipts } from './ReadReceipts';
import { AnnouncementStats } from './AnnouncementStats';
import { SmackTalkPicker } from './SmackTalkPicker';
import { SmackTalkPopup } from './SmackTalkPopup';
import { DateSeparator } from './DateSeparator';
import { useUserRole } from '@/hooks/useUserRole';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';

const MESSAGES_PER_PAGE = 25;

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
  parent_message_id: string | null;
  profiles?: {
    full_name: string;
    profile_photo_url: string | null;
  };
  parent_message?: ParentMessageData[] | ParentMessageData | null;
  isPending?: boolean;
  isNew?: boolean; // For fade-in animation
}

interface ChatDetails {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement: boolean;
  is_arcade?: boolean;
  group_image_url: string | null;
  created_by: string;
}

interface ChatWindowProps {
  chatId: string;
  chatDetails: ChatDetails | null;
  onChatDeleted: () => void;
  onChatUpdated: () => void;
}

export function ChatWindow({ chatId, chatDetails, onChatDeleted, onChatUpdated }: ChatWindowProps) {
  const { user } = useAuth();
  const currentUserId = user?.id || null;
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();
  
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [smackTalkPopup, setSmackTalkPopup] = useState<{ text: string; senderName: string } | null>(null);
  const [processedSmackTalks, setProcessedSmackTalks] = useState<Set<string>>(new Set());
  const [isArcadeChat, setIsArcadeChat] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [signedAttachmentUrls, setSignedAttachmentUrls] = useState<Record<string, string>>({});
  const [earlierMessages, setEarlierMessages] = useState<Message[]>([]);
  const [hasMoreEarlier, setHasMoreEarlier] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [showNewMessageBubble, setShowNewMessageBubble] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);

  // Check if user is near bottom of scroll
  const checkIfNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150; // pixels from bottom
    const isNear = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    isNearBottomRef.current = isNear;
    if (isNear) {
      setShowNewMessageBubble(false);
      setNewMessageCount(0);
    }
    return isNear;
  }, []);

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
    setShowNewMessageBubble(false);
    setNewMessageCount(0);
  }, []);

  const parseStorageObjectUrl = (url: string): { bucket: string; path: string } | null => {
    const match = url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
    if (!match) return null;
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  };

  // Fetch latest 50 messages with React Query
  const { data: recentMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['chat-messages', chatId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          profiles!messages_sender_id_fkey(full_name, profile_photo_url)
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(MESSAGES_PER_PAGE);

      if (error) throw error;

      // Bulk fetch parent messages
      const parentIds = Array.from(
        new Set((data || []).map((m) => m.parent_message_id).filter(Boolean) as string[])
      );

      const parentMap = new Map<string, any>();
      if (parentIds.length > 0) {
        const { data: parentRows } = await supabase
          .from('messages')
          .select('id, content, profiles:profiles!messages_sender_id_fkey(full_name)')
          .in('id', parentIds);

        for (const p of parentRows || []) parentMap.set(p.id, p);
      }

      const messagesWithParent = (data || []).map((msg: any) => {
        const parent = msg.parent_message_id ? parentMap.get(msg.parent_message_id) : null;
        return { ...msg, parent_message: parent || null };
      });

      // Return in ascending order for display (newest at bottom)
      return messagesWithParent.reverse() as Message[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - cache for background, but...
    refetchOnMount: 'always', // Always fetch fresh when opening a chat
    enabled: !!chatId,
  });

  // Combine earlier + recent messages
  const messages = [...earlierMessages, ...recentMessages];

  // Load earlier messages handler
  const loadEarlierMessages = async () => {
    if (!hasMoreEarlier || loadingEarlier) return;
    
    setLoadingEarlier(true);
    const scrollContainer = messagesContainerRef.current;
    const scrollHeightBefore = scrollContainer?.scrollHeight || 0;
    
    try {
      const oldestMessage = messages[0];
      if (!oldestMessage) return;

      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          profiles!messages_sender_id_fkey(full_name, profile_photo_url)
        `)
        .eq('chat_id', chatId)
        .lt('created_at', oldestMessage.created_at)
        .order('created_at', { ascending: false })
        .limit(MESSAGES_PER_PAGE);

      if (error) throw error;

      if (!data || data.length === 0) {
        setHasMoreEarlier(false);
        return;
      }

      if (data.length < MESSAGES_PER_PAGE) {
        setHasMoreEarlier(false);
      }

      // Bulk fetch parent messages
      const parentIds = Array.from(
        new Set(data.map((m) => m.parent_message_id).filter(Boolean) as string[])
      );

      const parentMap = new Map<string, any>();
      if (parentIds.length > 0) {
        const { data: parentRows } = await supabase
          .from('messages')
          .select('id, content, profiles:profiles!messages_sender_id_fkey(full_name)')
          .in('id', parentIds);

        for (const p of parentRows || []) parentMap.set(p.id, p);
      }

      const messagesWithParent = data.map((msg: any) => {
        const parent = msg.parent_message_id ? parentMap.get(msg.parent_message_id) : null;
        return { ...msg, parent_message: parent || null };
      });

      // Prepend older messages (reverse to get ascending order)
      setEarlierMessages(prev => [...messagesWithParent.reverse(), ...prev]);
      
      // Maintain scroll position after prepending
      requestAnimationFrame(() => {
        if (scrollContainer) {
          const scrollHeightAfter = scrollContainer.scrollHeight;
          scrollContainer.scrollTop = scrollHeightAfter - scrollHeightBefore;
        }
      });
    } catch (error) {
      console.error('Error loading earlier messages:', error);
      toast.error('Failed to load earlier messages');
    } finally {
      setLoadingEarlier(false);
    }
  };

  // Reset earlier messages when chat changes
  useEffect(() => {
    setEarlierMessages([]);
    setHasMoreEarlier(true);
    setShowNewMessageBubble(false);
    setNewMessageCount(0);
  }, [chatId]);

  // Resolve signed URLs for attachments
  useEffect(() => {
    const resolveSignedUrls = async () => {
      const toResolve = messages.filter((m) => m.attachment_url && !signedAttachmentUrls[m.id]);
      if (toResolve.length === 0) return;

      const results = await Promise.all(
        toResolve.map(async (m) => {
          const parsed = parseStorageObjectUrl(m.attachment_url!);
          if (!parsed) return null;

          const { data, error } = await supabase.storage
            .from(parsed.bucket)
            .createSignedUrl(parsed.path, 60 * 60);

          if (error || !data?.signedUrl) return null;
          return { id: m.id, url: data.signedUrl };
        })
      );

      const next: Record<string, string> = {};
      for (const r of results) {
        if (r) next[r.id] = r.url;
      }
      if (Object.keys(next).length > 0) {
        setSignedAttachmentUrls((prev) => ({ ...prev, ...next }));
      }
    };

    resolveSignedUrls();
  }, [messages, signedAttachmentUrls]);

  // Check if this is an arcade chat
  useEffect(() => {
    const checkArcadeChat = async () => {
      if (!chatId) return;
      const { data } = await supabase
        .from('chats')
        .select('is_arcade')
        .eq('id', chatId)
        .single();
      setIsArcadeChat(data?.is_arcade || false);
    };
    checkArcadeChat();
  }, [chatId]);

  // Show smack talk popup for new messages
  const handleNewSmackTalk = useCallback((message: Message) => {
    if (!message.content?.startsWith('SMACK_TALK:')) return;
    if (message.sender_id === currentUserId) return;
    if (processedSmackTalks.has(message.id)) return;
    
    const smackText = message.content.replace('SMACK_TALK:', '');
    const senderName = message.profiles?.full_name || 'Someone';
    
    setProcessedSmackTalks(prev => new Set([...prev, message.id]));
    setSmackTalkPopup({ text: smackText, senderName });
  }, [currentUserId, processedSmackTalks]);

  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      handleNewSmackTalk(latestMessage);
    }
  }, [messages, handleNewSmackTalk]);

  // Mark announcement as opened
  useEffect(() => {
    if (chatDetails?.is_announcement && currentUserId && currentUserId !== chatDetails.created_by) {
      const markAsOpened = async () => {
        try {
          await supabase
            .from('announcement_reads')
            .insert({
              chat_id: chatId,
              user_id: currentUserId
            });
        } catch (err: any) {
          if (!err.message?.includes('duplicate')) {
            console.error('Error marking announcement as opened:', err);
          }
        }
      };
      markAsOpened();
    }
  }, [chatId, chatDetails, currentUserId]);

  // Mark chat as read IMMEDIATELY on chat open (not waiting for messages)
  useEffect(() => {
    if (!currentUserId || !chatId) return;
    markChatAsRead(chatId, currentUserId);
  }, [chatId, currentUserId]);

  // Track scroll position to enable smart auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      checkIfNearBottom();
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfNearBottom]);

  // Auto-scroll to bottom when opening a chat (any chat, cached or not)
  useEffect(() => {
    if (recentMessages.length > 0 && !messagesLoading) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    }
  }, [chatId, recentMessages.length, messagesLoading, scrollToBottom]); // Use recentMessages.length to trigger on cache hits

  // Realtime subscription - append new messages directly instead of refetching
  useEffect(() => {
    if (!chatId) return;

    const channel = supabase
      .channel(`messages-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          const newMsg = payload.new as any;
          
          // Fetch the sender profile for the new message
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, profile_photo_url')
            .eq('id', newMsg.sender_id)
            .single();

          const messageWithProfile: Message = {
            ...newMsg,
            profiles: profile || undefined,
            parent_message: null,
            isNew: true, // Mark for fade-in animation
          };

          // Append to cache instead of refetching
          queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
            if (!old) return [messageWithProfile];
            // Avoid duplicates
            if (old.some(m => m.id === newMsg.id)) return old;
            return [...old, messageWithProfile];
          });

          // Remove from pending if it was an optimistic update
          setPendingMessages(prev => prev.filter(m => 
            !(m.content === newMsg.content && m.sender_id === newMsg.sender_id)
          ));

          // Smart scroll: only auto-scroll if near bottom, otherwise show bubble
          if (isNearBottomRef.current) {
            setTimeout(() => scrollToBottom(), 50);
          } else if (newMsg.sender_id !== currentUserId) {
            // Show "new message" bubble for messages from others
            setShowNewMessageBubble(true);
            setNewMessageCount(prev => prev + 1);
          }
          
          // Mark as read since chat is open
          if (currentUserId) {
            markChatAsRead(chatId, currentUserId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, queryClient, scrollToBottom, currentUserId]);

  const handleSend = async () => {
    if (!newMessage.trim() && !uploading) return;
    if (!currentUserId) return;

    const messageContent = newMessage.trim();
    const replyTo = replyToMessage;
    
    // Clear input immediately for snappy UX
    setNewMessage('');
    setReplyToMessage(null);
    
    // Create optimistic message
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      content: messageContent || null,
      sender_id: currentUserId,
      attachment_url: null,
      attachment_type: null,
      created_at: new Date().toISOString(),
      parent_message_id: replyTo?.id || null,
      parent_message: replyTo ? { 
        content: replyTo.content, 
        profiles: replyTo.profiles ? { full_name: replyTo.profiles.full_name } : null 
      } : null,
      isPending: true,
    };
    
    // Add to pending messages immediately
    setPendingMessages(prev => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      if (!currentUserId) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: currentUserId,
          content: messageContent || null,
          parent_message_id: replyTo?.id || null,
        });

      if (error) throw error;

      // Remove from pending (realtime will add the real message)
      setPendingMessages(prev => prev.filter(m => m.id !== optimisticId));

      // Send push notifications to chat members
      try {
        const { data: members, error: membersError } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId)
          .neq('user_id', currentUserId);

        if (membersError) {
          console.error('Error fetching chat members:', membersError);
        }

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: senderProfile?.full_name || 'New Message',
              body: messageContent.substring(0, 100),
              notification_type: 'chat_messages',
              data: {
                chat_id: chatId,
                type: 'message'
              }
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
      }

    } catch (error: any) {
      console.error('Error sending message:', error);
      // Remove failed pending message and show error
      setPendingMessages(prev => prev.filter(m => m.id !== optimisticId));
      toast.error('Failed to send message');
      // Restore the message to input
      setNewMessage(messageContent);
    }
  };

  const handleReaction = async (messageId: string, reaction: string) => {
    if (!currentUserId) return;

    try {
      // Check if user already has this reaction
      const { data: existing } = await supabase
        .from('message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', currentUserId)
        .eq('reaction', reaction)
        .maybeSingle();

      if (existing) {
        // Remove existing reaction
        await supabase
          .from('message_reactions')
          .delete()
          .eq('id', existing.id);
      } else {
        // Add new reaction
        const { error } = await supabase
          .from('message_reactions')
          .insert({
            message_id: messageId,
            user_id: currentUserId,
            reaction
          });

        if (error) throw error;
      }
    } catch (error: any) {
      console.error('Error toggling reaction:', error);
      toast.error('Failed to update reaction');
    }
  };

  const handleGifSelect = async (gifUrl: string) => {
    if (!currentUserId) return;
    setSending(true);
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: currentUserId,
          content: 'GIF',
          attachment_url: gifUrl,
          attachment_type: 'image/gif',
        });

      if (error) throw error;

      // Send push notifications
      try {
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId)
          .neq('user_id', currentUserId);

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: senderProfile?.full_name || 'New Message',
              body: 'Sent a GIF',
              notification_type: 'chat_messages',
              data: { chat_id: chatId, type: 'message' }
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
      }

      scrollToBottom();
    } catch (error: any) {
      console.error('Error sending GIF:', error);
      toast.error('Failed to send GIF');
    } finally {
      setSending(false);
    }
  };

  const handleSmackTalk = async (smackText: string, targetMessageId?: string) => {
    if (!currentUserId) return;
    setSending(true);
    try {
      const content = `SMACK_TALK:${smackText}`;

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: currentUserId,
          content,
          parent_message_id: targetMessageId || null,
        });

      if (error) throw error;

      // Send push notifications
      try {
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId)
          .neq('user_id', currentUserId);

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: `⚡ ${senderProfile?.full_name || 'Someone'} says:`,
              body: smackText,
              notification_type: 'chat_messages',
              data: { chat_id: chatId, type: 'smack_talk' }
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
      }

      scrollToBottom();
    } catch (error: any) {
      console.error('Error sending smack talk:', error);
      toast.error('Failed to send smack talk');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteChat = async () => {
    try {
      const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', chatId);

      if (error) throw error;

      toast.success('Chat deleted');
      onChatDeleted();
    } catch (error: any) {
      console.error('Error deleting chat:', error);
      toast.error('Failed to delete chat');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserId) return;

    setUploading(true);
    try {
      // Compress images to reduce memory usage on mobile
      let fileToUpload: File | Blob = file;
      let fileName = `${currentUserId}/${Date.now()}.${file.name.split('.').pop()}`;
      const bucketName = 'checklist-images';

      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${currentUserId}/${Date.now()}.jpg`;
      }

      // Use retry logic for flaky mobile connections
      const { publicUrl } = await uploadWithRetry(supabase, bucketName, fileName, fileToUpload as File, 3);

      const { error: insertError } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: currentUserId,
          content: file.name,
          attachment_url: publicUrl,
          attachment_type: file.type,
        });

      if (insertError) throw insertError;

      // Send push notifications for file attachment
      try {
        const { data: members } = await supabase
          .from('chat_members')
          .select('user_id')
          .eq('chat_id', chatId)
          .neq('user_id', currentUserId);

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: senderProfile?.full_name || 'New Message',
              body: `Sent ${file.type.startsWith('image/') ? 'an image' : 'a file'}`,
              notification_type: 'chat_messages',
              data: {
                chat_id: chatId,
                type: 'message'
              }
            }
          });
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
      }

      toast.success('File uploaded');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {chatDetails && (
        <div className="border-b border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                {chatDetails.is_announcement ? (
                  <AvatarFallback className="bg-primary/10">
                    <Megaphone className="h-5 w-5 text-primary" />
                  </AvatarFallback>
                ) : chatDetails.is_group ? (
                  <>
                    <AvatarImage src={chatDetails.group_image_url || undefined} />
                    <AvatarFallback>
                      <Users className="h-5 w-5" />
                    </AvatarFallback>
                  </>
                ) : (
                  <>
                    <AvatarImage src={chatDetails.group_image_url || undefined} />
                    <AvatarFallback>
                      {chatDetails.title?.charAt(0) || 'C'}
                    </AvatarFallback>
                  </>
                )}
              </Avatar>
              <div>
                <h3 className="font-semibold">{chatDetails.title || 'Chat'}</h3>
                {chatDetails.is_announcement ? (
                  <p className="text-xs text-muted-foreground">📢 Announcement</p>
                ) : chatDetails.is_group ? (
                  <p className="text-xs text-muted-foreground">Group Chat</p>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2">
              {chatDetails.is_group && isAdmin && chatDetails.title !== "Shift Marketplace" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              )}
              {isAdmin && chatDetails.title !== "Shift Marketplace" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 scroll-smooth overscroll-contain">
        {/* New Message Bubble */}
        {showNewMessageBubble && (
          <button
            onClick={() => scrollToBottom()}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-20 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-bounce hover:bg-primary/90 transition-colors"
          >
            <span>New message{newMessageCount > 1 ? `s (${newMessageCount})` : ''}</span>
            <span className="text-lg">↓</span>
          </button>
        )}
        {/* Load Earlier Button */}
        {hasMoreEarlier && messages.length > 0 && (
          <div className="flex justify-center sticky top-0 z-10">
            <Button
              variant="outline"
              size="sm"
              onClick={loadEarlierMessages}
              disabled={loadingEarlier}
              className="bg-background/95 backdrop-blur-sm shadow-sm"
            >
              {loadingEarlier ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                'Load Earlier Messages'
              )}
            </Button>
          </div>
        )}

        {/* Loading state */}
        {messagesLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {(() => {
          // Combine actual messages with pending messages
          const allMessages = [...messages, ...pendingMessages];
          
          // Build a map of game score message IDs to their smack talk overlays
          const smackTalkMap = new Map<string, { text: string; senderName: string }[]>();

          // First pass: identify all game score messages
          allMessages.forEach((msg) => {
            if (msg.content?.startsWith('GAME_SCORE:')) {
              smackTalkMap.set(msg.id, []);
            }
          });

          // Second pass: associate smack talks with their target game scores via parent_message_id
          allMessages.forEach((msg) => {
            if (msg.content?.startsWith('SMACK_TALK:') && msg.parent_message_id) {
              const smacks = smackTalkMap.get(msg.parent_message_id) || [];
              smacks.push({
                text: msg.content.replace('SMACK_TALK:', ''),
                senderName: msg.profiles?.full_name || 'Someone'
              });
              smackTalkMap.set(msg.parent_message_id, smacks);
            }
          });

          return allMessages.map((message, index) => {
            const isOwnMessage = currentUserId && message.sender_id === currentUserId;
            const isPending = message.isPending;
            
            // Skip smack talk messages that are linked to a game score - they're shown as overlays
            if (message.content?.startsWith('SMACK_TALK:') && message.parent_message_id) {
              return null;
            }

            // Get smack talks for this game score (by message ID)
            const smackTalks = smackTalkMap.get(message.id) || [];
            
            // Date separator logic
            const messageDate = new Date(message.created_at);
            const prevMessage = index > 0 ? allMessages[index - 1] : null;
            const showDateSeparator = !prevMessage || !isSameDay(messageDate, new Date(prevMessage.created_at));
            
            return (
              <div key={message.id} className={message.isNew ? 'animate-fade-in' : ''}>
                {showDateSeparator && <DateSeparator date={messageDate} />}
              <div
                className={`flex gap-2 sm:gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
              >
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarImage src={message.profiles?.profile_photo_url || undefined} />
                  <AvatarFallback>
                    {message.profiles?.full_name?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className={`flex flex-col min-w-0 max-w-[75%] ${isOwnMessage ? 'items-end' : ''}`}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {isPending ? 'You' : (message.profiles?.full_name || 'Unknown')}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isPending ? 'Sending...' : format(new Date(message.created_at), 'h:mm a')}
                    </span>
                    {!isPending && (
                      <ReadReceipts
                        messageId={message.id}
                        senderId={message.sender_id}
                        currentUserId={currentUserId}
                        chatId={chatId}
                      />
                    )}
                  </div>
                  <div>
                    <div
                      className={`rounded-lg p-3 relative ${
                        isOwnMessage
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      } ${message.content?.startsWith('GAME_SCORE:') ? 'overflow-visible' : ''} ${
                        isPending ? 'opacity-70' : ''
                      }`}
                    >
                      {/* Sending progress indicator */}
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
                          <div className={`mb-2 p-2 rounded text-sm border-l-2 overflow-hidden ${
                            isOwnMessage 
                              ? 'bg-primary-foreground/10 border-primary-foreground/50' 
                              : 'bg-background/50 border-primary/50'
                          }`}>
                            <p className={`text-xs font-medium mb-0.5 ${isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                              Replying to {parent.profiles?.full_name || 'Unknown'}
                            </p>
                            <p className={`text-sm line-clamp-2 ${isOwnMessage ? 'text-primary-foreground/80' : 'text-foreground/70'}`}>
                              {parent.content || 'Attachment'}
                            </p>
                          </div>
                        );
                      })()}
                      {message.attachment_url && (() => {
                        const displayUrl = signedAttachmentUrls[message.id] || message.attachment_url;
                        return (
                          <div className="mb-2">
                            {message.attachment_type?.startsWith('image/') ? (
                              <img
                                src={displayUrl}
                                alt="Message attachment"
                                className="rounded max-w-xs cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setViewingImage(displayUrl)}
                                loading="lazy"
                              />
                            ) : (
                              <a
                                href={displayUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 hover:underline"
                              >
                                <File className="h-4 w-4" />
                                {message.content || 'Attachment'}
                              </a>
                            )}
                          </div>
                        );
                      })()}
                      {message.content && (
                        <MessageContent 
                          content={message.content} 
                          chatId={chatId} 
                          senderName={message.profiles?.full_name}
                          smackTalks={smackTalks}
                        />
                      )}
                    </div>
                    {!chatDetails?.is_announcement && !isPending && (
                      <>
                        <div className="flex items-center gap-2 mt-1">
                          <ReactionPicker onSelect={(reaction) => handleReaction(message.id, reaction)} />
                          {isArcadeChat && message.content?.startsWith('GAME_SCORE:') && (
                            <SmackTalkPicker onSelect={(text) => handleSmackTalk(text, message.id)} disabled={sending} />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => setReplyToMessage(message)}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        </div>
                        <MessageReactions messageId={message.id} currentUserId={currentUserId} />
                      </>
                    )}
                  </div>
                </div>
              </div>
              </div>
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      {/* Announcement Stats - at bottom, discreet */}
      {chatDetails?.is_announcement && isAdmin && (
        <div className="px-4 pb-2 opacity-60">
          <div className="scale-90 origin-bottom">
            <AnnouncementStats chatId={chatId} />
          </div>
        </div>
      )}

      {/* Input - Hide for announcements */}
      {!chatDetails?.is_announcement && (
        <div className="border-t border-border p-4 mb-4 flex-shrink-0">
        {replyToMessage && (
          <div className="mb-2 p-2 bg-muted rounded flex items-center justify-between">
            <div className="text-sm">
              <p className="text-muted-foreground">Replying to {replyToMessage.profiles?.full_name}</p>
              <p className="truncate">{replyToMessage.content}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplyToMessage(null)}
            >
              ×
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            accept="image/*,.pdf,.doc,.docx"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <GifPicker onSelect={handleGifSelect} />
          <MentionInput
            value={newMessage}
            onChange={setNewMessage}
            placeholder="Type a message... Use @ to mention"
            chatId={chatId}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={sending || uploading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this chat and all its messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChat} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Group Settings Dialog */}
      {chatDetails?.is_group && (
        <GroupSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          chatId={chatId}
          chatTitle={chatDetails.title || ''}
          groupImageUrl={chatDetails.group_image_url}
          onUpdate={onChatUpdated}
        />
      )}

      {/* Smack Talk Popup */}
      {smackTalkPopup && (
        <SmackTalkPopup
          text={smackTalkPopup.text}
          senderName={smackTalkPopup.senderName}
          onComplete={() => setSmackTalkPopup(null)}
        />
      )}

      {/* Image Viewer Dialog */}
      <Dialog open={!!viewingImage} onOpenChange={() => setViewingImage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-2 bg-black/90 border-none">
          {viewingImage && (
            <img
              src={viewingImage}
              alt="Full size attachment"
              className="w-full h-full object-contain max-h-[90vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}