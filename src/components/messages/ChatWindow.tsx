import { getDisplayName } from '@/utils/displayName';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Settings, Trash2, Megaphone, Users, Loader2, ChevronDown } from 'lucide-react';
import { isSameDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Virtuoso } from 'react-virtuoso';
import { GroupSettingsDialog } from './GroupSettingsDialog';
import { AnnouncementStats } from './AnnouncementStats';
import { SmackTalkPopup } from './SmackTalkPopup';
import { DateSeparator } from './DateSeparator';
import { MemoizedMessageBubble } from './MemoizedMessageBubble';
import { IMessageInput } from './iMessageInput';
import { VirtuosoPanYScroller } from './VirtuosoPanYScroller';
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
import { useChatWindowData, type ChatDetails } from '@/hooks/useChatWindowData';
import { useChatActions } from '@/hooks/useChatActions';

interface ChatWindowProps {
  chatId: string;
  chatDetails: ChatDetails | null;
  onChatDeleted: () => void;
  onChatUpdated: () => void;
}

export function ChatWindow({ chatId, chatDetails, onChatDeleted, onChatUpdated }: ChatWindowProps) {
  const data = useChatWindowData(chatId, chatDetails);
  const {
    currentUserId, isAdmin,
    messages, messagesLoading,
    replyToMessage, setReplyToMessage,
    settingsOpen, setSettingsOpen,
    deleteDialogOpen, setDeleteDialogOpen,
    smackTalkPopup, setSmackTalkPopup,
    isArcadeChat,
    viewingImage, setViewingImage,
    signedAttachmentUrls,
    hasMoreEarlier, loadingEarlier,
    showNewMessageBubble, newMessageCount,
    newMessage, setNewMessage,
    sending, setSending,
    uploading, setUploading,
    virtuosoRef,
    isScrolledUp, setIsScrolledUp,
    scrollToBottom, loadEarlierMessages,
  } = data;

  const actions = useChatActions({
    chatId,
    newMessage,
    setNewMessage,
    replyToMessage,
    setReplyToMessage,
    setSending,
    setUploading,
    scrollToBottom,
    onChatDeleted,
  });

  // Build smack talk map for game scores
  const smackTalkMap = new Map<string, { text: string; senderName: string }[]>();
  messages.forEach((msg) => {
    if (msg.content?.startsWith('GAME_SCORE:')) {
      smackTalkMap.set(msg.id, []);
    }
  });
  messages.forEach((msg) => {
    if (msg.content?.startsWith('SMACK_TALK:') && msg.parent_message_id) {
      const smacks = smackTalkMap.get(msg.parent_message_id) || [];
      smacks.push({
        text: msg.content.replace('SMACK_TALK:', ''),
        senderName: getDisplayName(msg.profiles?.full_name, msg.profiles?.nickname) || 'Someone'
      });
      smackTalkMap.set(msg.parent_message_id, smacks);
    }
  });

  const displayMessages = messages.filter(
    msg => !(msg.content?.startsWith('SMACK_TALK:') && msg.parent_message_id)
  );

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
                    <AvatarFallback><Users className="h-5 w-5" /></AvatarFallback>
                  </>
                ) : (
                  <>
                    <AvatarImage src={chatDetails.group_image_url || undefined} />
                    <AvatarFallback>{chatDetails.title?.charAt(0) || 'C'}</AvatarFallback>
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
                <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
                  <Settings className="h-4 w-4" />
                </Button>
              )}
              {isAdmin && chatDetails.title !== "Shift Marketplace" && (
                <Button variant="ghost" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages - Virtualized */}
      <div className="flex-1 min-h-0 overflow-hidden overflow-x-hidden relative">
        {/* Scroll to bottom + mark as read button */}
        {isScrolledUp && displayMessages.length > 0 && (
          <button
            onClick={() => {
              scrollToBottom();
              // Mark chat as read optimistically
              if (data.currentUserId && chatId) {
                supabase
                  .from('chat_members')
                  .update({ last_read_at: new Date().toISOString() })
                  .eq('chat_id', chatId)
                  .eq('user_id', data.currentUserId)
                  .then();
              }
            }}
            className="absolute bottom-4 right-4 z-20 bg-primary text-primary-foreground h-10 w-10 rounded-full shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
          >
            {showNewMessageBubble && newMessageCount > 0 ? (
              <span className="text-xs font-bold">{newMessageCount > 99 ? '99+' : newMessageCount}</span>
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </button>
        )}
        
        {messagesLoading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {displayMessages.length > 0 && (
          <Virtuoso
            ref={virtuosoRef}
            data={displayMessages}
            initialTopMostItemIndex={displayMessages.length - 1}
            followOutput="smooth"
            alignToBottom
            atBottomStateChange={(atBottom) => {
              setIsScrolledUp(!atBottom);
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
              const smackTalks = smackTalkMap.get(message.id) || [];
              
              const messageDate = new Date(message.created_at);
              const prevMessage = index > 0 ? displayMessages[index - 1] : null;
              const nextMessage = index < displayMessages.length - 1 ? displayMessages[index + 1] : null;
              const showDateSeparator = !prevMessage || !isSameDay(messageDate, new Date(prevMessage.created_at));
              
              const prevSameSender = prevMessage && prevMessage.sender_id === message.sender_id && 
                isSameDay(new Date(prevMessage.created_at), messageDate);
              const nextSameSender = nextMessage && nextMessage.sender_id === message.sender_id &&
                isSameDay(new Date(nextMessage.created_at), messageDate);
              
              const isFirstInCluster = !prevSameSender || showDateSeparator;
              const isLastInCluster = !nextSameSender;
              const showAvatar = isLastInCluster && !isOwnMessage;
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
                    canUnsend={isAdmin}
                    smackTalks={smackTalks}
                    signedAttachmentUrl={signedAttachmentUrls[message.id]}
                    onReaction={actions.handleReaction}
                    onReply={setReplyToMessage}
                    onSmackTalk={actions.handleSmackTalk}
                    onImageClick={setViewingImage}
                    onUnsend={actions.handleUnsendMessage}
                    sending={sending}
                  />
                </div>
              );
            }}
          />
        )}
      </div>

      {/* Announcement Stats */}
      {chatDetails?.is_announcement && isAdmin && (
        <div className="px-4 pb-2 opacity-60">
          <div className="scale-90 origin-bottom">
            <AnnouncementStats chatId={chatId} announcementTitle={chatDetails.title || undefined} />
          </div>
        </div>
      )}

      {/* Input */}
      {!chatDetails?.is_announcement && (
        <IMessageInput
          value={newMessage}
          onChange={setNewMessage}
          onSend={actions.handleSend}
          onFileUpload={actions.handleFileUpload}
          onGifSelect={actions.handleGifSelect}
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
            <AlertDialogAction onClick={actions.handleDeleteChat} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Group Settings */}
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

      {/* Image Viewer */}
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
