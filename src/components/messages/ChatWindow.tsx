import { useState, useEffect, useRef, useCallback } from 'react';
import { getDisplayName } from '@/utils/displayName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { markChatAsRead } from '@/hooks/useUnreadMessages';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Settings, Trash2, Megaphone, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { isSameDay } from 'date-fns';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { GroupSettingsDialog } from './GroupSettingsDialog';
import { AnnouncementStats } from './AnnouncementStats';
import { SmackTalkPopup } from './SmackTalkPopup';
import { DateSeparator } from './DateSeparator';
import { MemoizedMessageBubble } from './MemoizedMessageBubble';
import { IMessageInput } from './iMessageInput';
import { VirtuosoPanYScroller } from './VirtuosoPanYScroller';
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

const MESSAGES_PER_PAGE = 50; // Increased since virtualization handles large lists efficiently

interface ParentMessageData {
  content: string | null;
  profiles: {
    full_name: string;
    nickname?: string | null;
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
    nickname?: string | null;
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
  // pendingMessages state removed - now using optimistic updates directly in query cache
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
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isNearBottomRef = useRef(true);

  // iOS PWA/Safari: keep the input visible above the software keyboard.
  // We expose the keyboard height as a CSS variable so layout can respond via padding.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const raw = window.innerHeight - vv.height - vv.offsetTop;
      const isKeyboardOpen = raw > 120;
      const nextOffset = isKeyboardOpen ? `${Math.round(raw)}px` : '0px';

      document.documentElement.style.setProperty('--kb-offset', nextOffset);

      if (isKeyboardOpen) {
        document.documentElement.dataset.kb = 'open';
      } else {
        delete (document.documentElement.dataset as any).kb;
      }
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--kb-offset');
      delete (document.documentElement.dataset as any).kb;
    };
  }, []);

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
          profiles!messages_sender_id_fkey(full_name, nickname, profile_photo_url)
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
          .select('id, content, profiles:profiles!messages_sender_id_fkey(full_name, nickname)')
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
          profiles!messages_sender_id_fkey(full_name, nickname, profile_photo_url)
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
          .select('id, content, profiles:profiles!messages_sender_id_fkey(full_name, nickname)')
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
    const senderName = getDisplayName(message.profiles?.full_name, message.profiles?.nickname) || 'Someone';
    
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
          // Invalidate dashboard unread announcements query
          queryClient.invalidateQueries({ queryKey: ['unread-announcements-dashboard'] });
        } catch (err: any) {
          if (!err.message?.includes('duplicate')) {
            console.error('Error marking announcement as opened:', err);
          }
        }
      };
      markAsOpened();
    }
  }, [chatId, chatDetails, currentUserId, queryClient]);

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
        (payload) => {
          const newMsg = payload.new as any;

          const existingMessages =
            queryClient.getQueryData<Message[]>(['chat-messages', chatId]) || [];

          // If we've already added this exact row (e.g. we replaced an optimistic message
          // immediately after INSERT), do nothing to avoid duplicates.
          if (existingMessages.some((m) => m.id === newMsg.id)) {
            return;
          }

          // Check if this message is already in cache (from optimistic update)
          const isOptimisticUpdate = existingMessages.some(
            (m) => m.isPending && m.content === newMsg.content && m.sender_id === newMsg.sender_id
          );

          if (isOptimisticUpdate) {
            // Replace optimistic message with real one - no need to fetch profile, we have it
            queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
              if (!old) return [];
              return old.map((m) => {
                if (m.isPending && m.content === newMsg.content && m.sender_id === newMsg.sender_id) {
                  return { ...newMsg, profiles: m.profiles, parent_message: m.parent_message };
                }
                return m;
              });
            });
          } else {
            // Message from another user - add immediately with placeholder, fetch profile in background
            const messageWithoutProfile: Message = {
              ...newMsg,
              profiles: undefined,
              parent_message: null,
              isNew: true,
            };

            // Append immediately for instant display
            queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
              if (!old) return [messageWithoutProfile];
              if (old.some((m) => m.id === newMsg.id)) return old;
              return [...old, messageWithoutProfile];
            });

            // Fetch profile in background and update
            supabase
              .from('profiles')
              .select('full_name, nickname, profile_photo_url')
              .eq('id', newMsg.sender_id)
              .single()
              .then(({ data: profile }) => {
                if (profile) {
                  queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
                    if (!old) return [];
                    return old.map((m) => (m.id === newMsg.id ? { ...m, profiles: profile } : m));
                  });
                }
              });

            // Show "new message" bubble if not near bottom
            if (!isNearBottomRef.current) {
              setShowNewMessageBubble(true);
              setNewMessageCount((prev) => prev + 1);
            }
          }

          // Smart scroll: only auto-scroll if near bottom
          if (isNearBottomRef.current) {
            setTimeout(() => scrollToBottom(), 50);
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
    
    // Create optimistic message with user's profile for immediate display
    const optimisticId = `pending-${Date.now()}`;
    const userFullName = user?.user_metadata?.full_name || 'You';
    const optimisticMessage: Message = {
      id: optimisticId,
      content: messageContent || null,
      sender_id: currentUserId,
      attachment_url: null,
      attachment_type: null,
      created_at: new Date().toISOString(),
      scheduled_at: null,
      parent_message_id: replyTo?.id || null,
      parent_message: replyTo ? { 
        content: replyTo.content, 
        profiles: replyTo.profiles ? { full_name: replyTo.profiles.full_name, nickname: replyTo.profiles.nickname } : null 
      } : null,
      profiles: {
        full_name: userFullName,
        nickname: user?.user_metadata?.nickname || null,
        profile_photo_url: null,
      },
      isPending: true,
    };
    
    // Add optimistic message directly to query cache for INSTANT display
    queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
      return [...(old || []), optimisticMessage];
    });
    
    // Scroll immediately
    requestAnimationFrame(() => scrollToBottom(true));

    // Fire-and-forget database insert - don't block UI
    const sendMessage = async () => {
      try {
        // Select minimal fields so we can flip the optimistic bubble out of "Sending..."
        // immediately, without waiting for realtime roundtrip.
        const { data: inserted, error } = await supabase
          .from('messages')
          .insert({
            chat_id: chatId,
            sender_id: currentUserId,
            content: messageContent || null,
            parent_message_id: replyTo?.id || null,
          })
          .select('id, created_at')
          .single();

        if (error) throw error;

        if (inserted?.id) {
          queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
            if (!old) return [];
            return old.map((m) => {
              if (m.id !== optimisticId) return m;
              return {
                ...m,
                id: inserted.id,
                created_at: inserted.created_at ? inserted.created_at : m.created_at,
                isPending: false,
              };
            });
          });
        }

        // Send push notifications in background (fire and forget)
        (async () => {
          try {
            const { data: members } = await supabase
              .from('chat_members')
              .select('user_id')
              .eq('chat_id', chatId)
              .neq('user_id', currentUserId);

            if (members && members.length > 0) {
              const { data: senderProfile } = await supabase
                .from('profiles')
                .select('full_name, nickname')
                .eq('id', currentUserId)
                .single();

              await supabase.functions.invoke('send-push-notification', {
                body: {
                  user_ids: members.map(m => m.user_id),
                  sender_id: currentUserId,
                  title: getDisplayName(senderProfile?.full_name, senderProfile?.nickname) || 'New Message',
                  body: messageContent.substring(0, 100),
                  notification_type: 'chat_messages',
                  data: { chat_id: chatId, type: 'message' }
                }
              });
            }
          } catch (err) {
            console.error('Push notification error:', err);
          }
        })();

      } catch (error: any) {
        console.error('Error sending message:', error);
        // Remove optimistic message on error
        queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
          return (old || []).filter(m => m.id !== optimisticId);
        });
        toast.error('Failed to send message');
        setNewMessage(messageContent); // Restore message
      }
    };

    // Don't await - fire and forget for instant UI
    sendMessage();
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
            .select('full_name, nickname')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: getDisplayName(senderProfile?.full_name, senderProfile?.nickname) || 'New Message',
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
            .select('full_name, nickname')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: `⚡ ${getDisplayName(senderProfile?.full_name, senderProfile?.nickname) || 'Someone'} says:`,
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
            .select('full_name, nickname')
            .eq('id', currentUserId)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              sender_id: currentUserId, // Ensure sender doesn't receive their own notification
              title: getDisplayName(senderProfile?.full_name, senderProfile?.nickname) || 'New Message',
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
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
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

      {/* Messages - Virtualized for performance */}
      <div className="flex-1 min-h-0 overflow-hidden overflow-x-hidden relative">
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
        
        {/* Loading state */}
        {messagesLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Virtualized message list */}
        {messages.length > 0 && (() => {
          // Messages already include optimistic updates from query cache
          const allMessages = messages;
          
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
                senderName: getDisplayName(msg.profiles?.full_name, msg.profiles?.nickname) || 'Someone'
              });
              smackTalkMap.set(msg.parent_message_id, smacks);
            }
          });

          // Filter out smack talk messages for display
          const displayMessages = allMessages.filter(
            msg => !(msg.content?.startsWith('SMACK_TALK:') && msg.parent_message_id)
          );

          return (
            <Virtuoso
              ref={virtuosoRef}
              data={displayMessages}
              initialTopMostItemIndex={displayMessages.length - 1}
              followOutput="smooth"
              alignToBottom
              atBottomStateChange={(atBottom) => {
                isNearBottomRef.current = atBottom;
                if (atBottom) {
                  setShowNewMessageBubble(false);
                  setNewMessageCount(0);
                }
              }}
              startReached={() => {
                if (hasMoreEarlier && !loadingEarlier) {
                  loadEarlierMessages();
                }
              }}
              components={{
                Header: () => hasMoreEarlier ? (
                  <div className="flex justify-center py-2">
                    {loadingEarlier ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading...
                      </div>
                    ) : null}
                  </div>
                ) : null,
                Scroller: VirtuosoPanYScroller,
              }}
              className="h-full px-4 sm:px-6 overflow-x-hidden"
              itemContent={(index, message) => {
                const isOwnMessage = currentUserId && message.sender_id === currentUserId;
                
                // Get smack talks for this game score (by message ID)
                const smackTalks = smackTalkMap.get(message.id) || [];
                
                // Date separator logic
                const messageDate = new Date(message.created_at);
                const prevMessage = index > 0 ? displayMessages[index - 1] : null;
                const nextMessage = index < displayMessages.length - 1 ? displayMessages[index + 1] : null;
                const showDateSeparator = !prevMessage || !isSameDay(messageDate, new Date(prevMessage.created_at));
                
                // Clustering logic - group consecutive messages from same sender
                const prevSameSender = prevMessage && prevMessage.sender_id === message.sender_id && 
                  isSameDay(new Date(prevMessage.created_at), messageDate);
                const nextSameSender = nextMessage && nextMessage.sender_id === message.sender_id &&
                  isSameDay(new Date(nextMessage.created_at), messageDate);
                
                const isFirstInCluster = !prevSameSender || showDateSeparator;
                const isLastInCluster = !nextSameSender;
                
                // Show avatar only on last message of cluster for received messages
                const showAvatar = isLastInCluster && !isOwnMessage;
                // Show name only on first message of cluster
                const showName = isFirstInCluster && !isOwnMessage;
                
                return (
                  <div className={`py-0.5 ${message.isNew ? 'animate-fade-in' : ''}`}>
                    {showDateSeparator && <DateSeparator date={messageDate} />}
                    <MemoizedMessageBubble
                      message={message}
                      isOwnMessage={!!isOwnMessage}
                      showAvatar={showAvatar}
                      showName={showName}
                      isFirstInCluster={isFirstInCluster}
                      isLastInCluster={isLastInCluster}
                      chatId={chatId}
                      currentUserId={currentUserId}
                      isAnnouncement={chatDetails?.is_announcement || false}
                      isArcadeChat={isArcadeChat}
                      isGroupChat={chatDetails?.is_group || false}
                      smackTalks={smackTalks}
                      signedAttachmentUrl={signedAttachmentUrls[message.id]}
                      onReaction={handleReaction}
                      onReply={setReplyToMessage}
                      onSmackTalk={handleSmackTalk}
                      onImageClick={setViewingImage}
                      sending={sending}
                    />
                  </div>
                );
              }}
            />
          );
        })()}
      </div>

      {/* Announcement Stats - at bottom, discreet */}
      {chatDetails?.is_announcement && isAdmin && (
        <div className="px-4 pb-2 opacity-60">
          <div className="scale-90 origin-bottom">
            <AnnouncementStats chatId={chatId} announcementTitle={chatDetails.title || undefined} />
          </div>
        </div>
      )}

      {/* Input - Hide for announcements */}
      {!chatDetails?.is_announcement && (
        <IMessageInput
          value={newMessage}
          onChange={setNewMessage}
          onSend={handleSend}
          onFileUpload={handleFileUpload}
          onGifSelect={handleGifSelect}
          chatId={chatId}
          disabled={sending}
          uploading={uploading}
          replyTo={replyToMessage}
          onCancelReply={() => setReplyToMessage(null)}
        />
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