import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { compressImage, uploadWithRetry } from '@/utils/imageCompression';
import type { Message } from './useChatWindowData';
import { sendChatMessage, pushChatMessage, unsendMessage } from '@/lib/chatMessages';

interface UseChatActionsOptions {
  chatId: string;
  newMessage: string;
  setNewMessage: (v: string) => void;
  replyToMessage: Message | null;
  setReplyToMessage: (v: Message | null) => void;
  setSending: (v: boolean) => void;
  setUploading: (v: boolean) => void;
  scrollToBottom: (instant?: boolean) => void;
  onChatDeleted: () => void;
}

export function useChatActions({
  chatId,
  newMessage,
  setNewMessage,
  replyToMessage,
  setReplyToMessage,
  setSending,
  setUploading,
  scrollToBottom,
  onChatDeleted,
}: UseChatActionsOptions) {
  const { user } = useAuth();
  const currentUserId = user?.id || null;
  const queryClient = useQueryClient();

  // The push lives in the shared chat file (src/lib/chatMessages.ts); GIF and file sends still call it here.
  const sendPushNotification = useCallback(async (body: string, type = 'message') => {
    await pushChatMessage(chatId, currentUserId!, body, type);
  }, [chatId, currentUserId]);

  const handleSend = useCallback(async () => {
    if (!newMessage.trim() && true) return;
    if (!currentUserId) return;

    const messageContent = newMessage.trim();
    if (!messageContent) return;
    const replyTo = replyToMessage;
    
    setNewMessage('');
    setReplyToMessage(null);
    
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
    
    queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
      return [...(old || []), optimisticMessage];
    });
    
    requestAnimationFrame(() => scrollToBottom(true));

    const sendMessage = async () => {
      try {
        // The ONE typed-message send (insert + its push), shared with Theo's Send tap.
        const inserted = await sendChatMessage({ chatId, senderId: currentUserId, content: messageContent, parentMessageId: replyTo?.id || null });

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
      } catch (error: any) {
        console.error('Error sending message:', error);
        queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
          return (old || []).filter(m => m.id !== optimisticId);
        });
        toast.error('Failed to send message');
        setNewMessage(messageContent);
      }
    };

    sendMessage();
  }, [newMessage, currentUserId, replyToMessage, chatId, user, queryClient, scrollToBottom, setNewMessage, setReplyToMessage]);

  const handleReaction = useCallback(async (messageId: string, reaction: string) => {
    if (!currentUserId) return;

    try {
      const { data: existing } = await supabase
        .from('message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', currentUserId)
        .eq('reaction', reaction)
        .maybeSingle();

      if (existing) {
        await supabase.from('message_reactions').delete().eq('id', existing.id);
      } else {
        const { error } = await supabase.from('message_reactions').insert({
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
  }, [currentUserId]);

  const handleGifSelect = useCallback(async (gifUrl: string) => {
    if (!currentUserId) return;
    setSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        chat_id: chatId,
        sender_id: currentUserId,
        content: 'GIF',
        attachment_url: gifUrl,
        attachment_type: 'image/gif',
      });
      if (error) throw error;

      sendPushNotification('Sent a GIF');
      scrollToBottom();
    } catch (error: any) {
      console.error('Error sending GIF:', error);
      toast.error('Failed to send GIF');
    } finally {
      setSending(false);
    }
  }, [currentUserId, chatId, setSending, scrollToBottom, sendPushNotification]);


  const handleDeleteChat = useCallback(async () => {
    try {
      const { error } = await supabase.from('chats').delete().eq('id', chatId);
      if (error) throw error;
      toast.success('Chat deleted');
      onChatDeleted();
    } catch (error: any) {
      console.error('Error deleting chat:', error);
      toast.error('Failed to delete chat');
    }
  }, [chatId, onChatDeleted]);

  const handleUnsendMessage = useCallback(async (messageId: string) => {
    try {
      await unsendMessage(messageId, currentUserId!);

      // Optimistic update
      queryClient.setQueryData(['chat-messages', chatId], (old: Message[] | undefined) => {
        if (!old) return [];
        return old.map(m => m.id === messageId ? { ...m, is_deleted_for_everyone: true, content: null, attachment_url: null } : m);
      });

      toast.success('Message removed for everyone');
    } catch (error: any) {
      console.error('Error unsending message:', error);
      toast.error('Failed to remove message');
    }
  }, [currentUserId, chatId, queryClient]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserId) return;

    setUploading(true);
    try {
      let fileToUpload: File | Blob = file;
      let fileName = `${currentUserId}/${Date.now()}.${file.name.split('.').pop()}`;
      const bucketName = 'checklist-images';

      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${currentUserId}/${Date.now()}.jpg`;
      }

      const { publicUrl } = await uploadWithRetry(supabase, bucketName, fileName, fileToUpload as File, 3);

      const { error: insertError } = await supabase.from('messages').insert({
        chat_id: chatId,
        sender_id: currentUserId,
        content: file.name,
        attachment_url: publicUrl,
        attachment_type: file.type,
      });

      if (insertError) throw insertError;

      sendPushNotification(
        `Sent ${file.type.startsWith('image/') ? 'an image' : 'a file'}`
      );

      toast.success('File uploaded');
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  }, [currentUserId, chatId, setUploading, sendPushNotification]);

  return {
    handleSend,
    handleReaction,
    handleGifSelect,
    
    handleDeleteChat,
    handleUnsendMessage,
    handleFileUpload,
  };
}
