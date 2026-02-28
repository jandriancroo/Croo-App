import { useState, useEffect, useRef, useCallback } from 'react';
import { getDisplayName } from '@/utils/displayName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { markChatAsRead } from '@/hooks/useUnreadMessages';
import { useUserRole } from '@/hooks/useUserRole';
import { VirtuosoHandle } from 'react-virtuoso';

const MESSAGES_PER_PAGE = 50;

export interface ParentMessageData {
  content: string | null;
  profiles: {
    full_name: string;
    nickname?: string | null;
  } | null;
}

export interface Message {
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
  isNew?: boolean;
}

export interface ChatDetails {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement: boolean;
  is_arcade?: boolean;
  group_image_url: string | null;
  created_by: string;
}

export function useChatWindowData(chatId: string, chatDetails: ChatDetails | null) {
  const { user } = useAuth();
  const currentUserId = user?.id || null;
  const queryClient = useQueryClient();
  const { isAdmin } = useUserRole();

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
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isNearBottomRef = useRef(true);

  // iOS PWA keyboard handling
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

  const checkIfNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150;
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

  // Fetch latest messages with React Query
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

      return messagesWithParent.reverse() as Message[];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    enabled: !!chatId,
  });

  const messages = [...earlierMessages, ...recentMessages];

  // Load earlier messages
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

      setEarlierMessages(prev => [...messagesWithParent.reverse(), ...prev]);
      
      requestAnimationFrame(() => {
        if (scrollContainer) {
          const scrollHeightAfter = scrollContainer.scrollHeight;
          scrollContainer.scrollTop = scrollHeightAfter - scrollHeightBefore;
        }
      });
    } catch (error) {
      console.error('Error loading earlier messages:', error);
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

  // Check if arcade chat
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

  // Mark chat as read immediately on open
  useEffect(() => {
    if (!currentUserId || !chatId) return;
    markChatAsRead(chatId, currentUserId);
  }, [chatId, currentUserId]);

  // Track scroll position
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      checkIfNearBottom();
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfNearBottom]);

  // Auto-scroll to bottom when opening a chat
  useEffect(() => {
    if (recentMessages.length > 0 && !messagesLoading) {
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    }
  }, [chatId, recentMessages.length, messagesLoading, scrollToBottom]);

  // Realtime subscription
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

          if (existingMessages.some((m) => m.id === newMsg.id)) {
            return;
          }

          const isOptimisticUpdate = existingMessages.some(
            (m) => m.isPending && m.content === newMsg.content && m.sender_id === newMsg.sender_id
          );

          if (isOptimisticUpdate) {
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
            const messageWithoutProfile: Message = {
              ...newMsg,
              profiles: undefined,
              parent_message: null,
              isNew: true,
            };

            queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
              if (!old) return [messageWithoutProfile];
              if (old.some((m) => m.id === newMsg.id)) return old;
              return [...old, messageWithoutProfile];
            });

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

            if (!isNearBottomRef.current) {
              setShowNewMessageBubble(true);
              setNewMessageCount((prev) => prev + 1);
            }
          }

          if (isNearBottomRef.current) {
            setTimeout(() => scrollToBottom(), 50);
          }

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

  return {
    user,
    currentUserId,
    isAdmin,
    queryClient,
    messages,
    messagesLoading,
    replyToMessage,
    setReplyToMessage,
    settingsOpen,
    setSettingsOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    smackTalkPopup,
    setSmackTalkPopup,
    isArcadeChat,
    viewingImage,
    setViewingImage,
    signedAttachmentUrls,
    hasMoreEarlier,
    loadingEarlier,
    showNewMessageBubble,
    newMessageCount,
    newMessage,
    setNewMessage,
    sending,
    setSending,
    uploading,
    setUploading,
    messagesEndRef,
    messagesContainerRef,
    virtuosoRef,
    isNearBottomRef,
    scrollToBottom,
    loadEarlierMessages,
  };
}
