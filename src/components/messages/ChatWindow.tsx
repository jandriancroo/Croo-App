import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { MentionInput } from './MentionInput';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Paperclip, File, Settings, MessageSquare, Trash2, Megaphone, Users } from 'lucide-react';
import { GifPicker } from './GifPicker';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ReactionPicker } from './ReactionPicker';
import { MessageReactions } from './MessageReactions';
import { GroupSettingsDialog } from './GroupSettingsDialog';
import { MessageContent } from './MessageContent';
import { ReadReceipts } from './ReadReceipts';
import { AnnouncementStats } from './AnnouncementStats';
import { SmackTalkPicker } from './SmackTalkPicker';
import { SmackTalkPopup } from './SmackTalkPopup';
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
  isPending?: boolean; // For optimistic updates
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
  const { isAdmin } = useUserRole();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [smackTalkPopup, setSmackTalkPopup] = useState<{ text: string; senderName: string } | null>(null);
  const [processedSmackTalks, setProcessedSmackTalks] = useState<Set<string>>(new Set());
  const [isArcadeChat, setIsArcadeChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

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
    // Check for new smack talks in latest message
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      handleNewSmackTalk(latestMessage);
    }
  }, [messages, handleNewSmackTalk]);

  useEffect(() => {
    // Mark announcement as opened
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

  const fetchMessages = async () => {
    try {
      // Fetch messages without self-join (parent_message_id FK doesn't exist)
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          profiles!messages_sender_id_fkey(full_name, profile_photo_url)
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Enrich messages with parent message data
      const messagesWithParent = await Promise.all((data || []).map(async (msg) => {
        if (msg.parent_message_id) {
          const { data: parentData } = await supabase
            .from('messages')
            .select('content, profiles:profiles!messages_sender_id_fkey(full_name)')
            .eq('id', msg.parent_message_id)
            .maybeSingle();
          return { ...msg, parent_message: parentData };
        }
        return { ...msg, parent_message: null };
      }));
      
      setMessages(messagesWithParent);
      // Instant scroll on initial load
      setTimeout(() => scrollToBottom(true), 50);

      // Mark ALL unread messages as read
      if (currentUserId && data && data.length > 0) {
        // Get all messages not sent by current user
        const messagesToMark = data.filter(msg => msg.sender_id !== currentUserId);
        
        if (messagesToMark.length > 0) {
          try {
            // Upsert read receipts for all messages in this chat
            const receipts = messagesToMark.map(msg => ({
              message_id: msg.id,
              user_id: currentUserId
            }));
            
            await supabase
              .from('message_read_receipts')
              .upsert(receipts, { 
                onConflict: 'message_id,user_id',
                ignoreDuplicates: true 
              });
          } catch (err: any) {
            console.error('Error marking messages as read:', err);
          }
        }
      }
    } catch (error: any) {
      console.error('Error fetching messages:', error);
      toast.error('Failed to load messages');
    }
  };

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel(`messages-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, currentUserId]);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
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
          .neq('user_id', user.id);

        console.log('Chat members query result:', { members, membersError, chatId });

        if (membersError) {
          console.error('Error fetching chat members:', membersError);
        }

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();

          console.log('Sending push notification to', members.length, 'users');

          const response = await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
              title: senderProfile?.full_name || 'New Message',
              body: messageContent.substring(0, 100),
              notification_type: 'chat_messages',
              data: {
                chat_id: chatId,
                type: 'message'
              }
            }
          });

          console.log('Push notification response:', response);
        } else {
          console.log('No chat members found to notify');
        }
      } catch (notifError) {
        console.error('Error sending push notification:', notifError);
        // Don't fail the message send if notifications fail
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
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
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
          .neq('user_id', user.id);

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
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
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const content = `SMACK_TALK:${smackText}`;

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
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
          .neq('user_id', user.id);

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
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
    if (!file) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Compress images to reduce memory usage on mobile
      let fileToUpload: File | Blob = file;
      let fileName = `${user.id}/${Date.now()}.${file.name.split('.').pop()}`;
      const bucketName = 'checklist-images';

      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.8);
        fileName = `${user.id}/${Date.now()}.jpg`;
      }

      // Use retry logic for flaky mobile connections
      const { publicUrl } = await uploadWithRetry(supabase, bucketName, fileName, fileToUpload as File, 3);

      const { error: insertError } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
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
          .neq('user_id', user.id);

        if (members && members.length > 0) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();

          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: members.map(m => m.user_id),
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
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
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

          return allMessages.map((message) => {
            const isOwnMessage = currentUserId && message.sender_id === currentUserId;
            const isPending = message.isPending;
            
            // Skip smack talk messages that are linked to a game score - they're shown as overlays
            if (message.content?.startsWith('SMACK_TALK:') && message.parent_message_id) {
              return null;
            }

            // Get smack talks for this game score (by message ID)
            const smackTalks = smackTalkMap.get(message.id) || [];
            
            return (
              <div
                key={message.id}
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
                      {message.attachment_url && (
                        <div className="mb-2">
                          {message.attachment_type?.startsWith('image/') ? (
                            <img
                              src={message.attachment_url}
                              alt="Attachment"
                              className="rounded max-w-xs"
                            />
                          ) : (
                            <a
                              href={message.attachment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 hover:underline"
                            >
                              <File className="h-4 w-4" />
                              {message.content}
                            </a>
                          )}
                        </div>
                      )}
                      {message.content && !message.attachment_url && (
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
    </div>
  );
}