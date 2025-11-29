import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Paperclip, File, Settings, MessageSquare, Trash2, Megaphone, Users } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ReactionPicker } from './ReactionPicker';
import { MessageReactions } from './MessageReactions';
import { GroupSettingsDialog } from './GroupSettingsDialog';
import { MessageContent } from './MessageContent';
import { ReadReceipts } from './ReadReceipts';
import { AnnouncementStats } from './AnnouncementStats';
import { useUserRole } from '@/hooks/useUserRole';
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

interface Message {
  id: string;
  content: string | null;
  sender_id: string;
  attachment_url: string | null;
  attachment_type: string | null;
  created_at: string;
  profiles?: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

interface ChatDetails {
  id: string;
  title: string | null;
  is_group: boolean;
  is_announcement: boolean;
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

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
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          profiles!messages_sender_id_fkey(full_name, profile_photo_url)
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
      setTimeout(scrollToBottom, 100);

      // Mark messages as read
      if (currentUserId && data && data.length > 0) {
        const lastMessage = data[data.length - 1];
        
        // Only mark as read if the last message wasn't sent by current user
        if (lastMessage.sender_id !== currentUserId) {
          try {
            await supabase
              .from('message_read_receipts')
              .insert({
                message_id: lastMessage.id,
                user_id: currentUserId
              });
          } catch (err: any) {
            // Ignore duplicate key errors (already marked as read)
            if (!err.message?.includes('duplicate')) {
              console.error('Error marking message as read:', err);
            }
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

    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          sender_id: user.id,
          content: newMessage.trim() || null,
          parent_message_id: replyToMessage?.id || null,
        });

      if (error) throw error;

      setNewMessage('');
      setReplyToMessage(null);
      scrollToBottom();
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleReaction = async (messageId: string, reaction: string) => {
    if (!currentUserId) return;

    try {
      const { error } = await supabase
        .from('message_reactions')
        .insert({
          message_id: messageId,
          user_id: currentUserId,
          reaction
        });

      if (error) throw error;
    } catch (error: any) {
      console.error('Error adding reaction:', error);
      toast.error('Failed to add reaction');
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

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      const bucketName = file.type.startsWith('image/') ? 'checklist-images' : 'checklist-images';

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fileName);

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
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          const isOwnMessage = currentUserId && message.sender_id === currentUserId;
          
          return (
            <div
              key={message.id}
              className={`flex gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={message.profiles?.profile_photo_url || undefined} />
                <AvatarFallback>
                  {message.profiles?.full_name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className={`flex flex-col ${isOwnMessage ? 'items-end' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">
                    {message.profiles?.full_name || 'Unknown'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(message.created_at), 'h:mm a')}
                  </span>
                  <ReadReceipts
                    messageId={message.id}
                    senderId={message.sender_id}
                    currentUserId={currentUserId}
                    chatId={chatId}
                  />
                </div>
                <div>
                  <div
                    className={`rounded-lg p-3 max-w-md ${
                      isOwnMessage
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
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
                      <MessageContent content={message.content} chatId={chatId} />
                    )}
                  </div>
                  {!chatDetails?.is_announcement && (
                    <>
                      <div className="flex items-center gap-2 mt-1">
                        <ReactionPicker onSelect={(reaction) => handleReaction(message.id, reaction)} />
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
        })}
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
        <div className="border-t border-border p-4">
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
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
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
    </div>
  );
}