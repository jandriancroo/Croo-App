import { useState, useEffect, useRef } from 'react';
import { triggerChatCountRefetch } from '@/hooks/useChatUnreadCounts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, MessageCircle, Loader2, Copy, Check, ExternalLink, CalendarPlus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { InterviewScheduleDialog } from './InterviewScheduleDialog';
import { InterviewInviteMessage } from './InterviewInviteMessage';
import { ensureHiringConversation, sendInterviewInvite, cancelInterview } from '@/lib/hiring/interviewActions';
import type { InterviewScheduleDetails } from './InterviewScheduleDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Message {
  id: string;
  sender_type: 'staff' | 'applicant';
  sender_id: string | null;
  content: string;
  created_at: string;
  sender?: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

interface HiringChatPanelProps {
  applicationId: string;
  applicantName: string;
  onConversationDeleted?: () => void;
}

export function HiringChatPanel({ applicationId, applicantName, onConversationDeleted }: HiringChatPanelProps) {
  const { user } = useAuth();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOrCreateConversation();
  }, [applicationId]);

  const markConversationAsRead = async (convId: string) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('hiring_conversations')
      .update({ last_read_at: new Date().toISOString() })
      .eq('id', convId);

    if (error) {
      console.error('Error marking hiring conversation as read:', error);
      return;
    }

    triggerChatCountRefetch();
  };

  // Mark as read when opening the conversation
  useEffect(() => {
    if (!conversationId) return;
    markConversationAsRead(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // If an applicant message arrives while staff is viewing, immediately mark as read
  useEffect(() => {
    if (!conversationId) return;
    const latest = messages[messages.length - 1];
    if (!latest) return;
    if (latest.sender_type !== 'applicant') return;
    markConversationAsRead(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;

    // Subscribe to new messages
    const channel = supabase
      .channel(`hiring-staff-chat-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hiring_messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        async (payload) => {
          const newMsg = payload.new as Message;
          
          // Fetch sender info if staff message
          if (newMsg.sender_type === 'staff' && newMsg.sender_id) {
            const { data: sender } = await supabase
              .from('profiles')
              .select('full_name, profile_photo_url')
              .eq('id', newMsg.sender_id)
              .single();
            newMsg.sender = sender || undefined;
          }
          
          setMessages(prev => [...prev, newMsg]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const fetchOrCreateConversation = async () => {
    try {
      const conv = await ensureHiringConversation(applicationId);
      setConversationId(conv.id);
      setAccessToken(conv.access_token);
      await fetchMessages(conv.id);
      await markConversationAsRead(conv.id);
    } catch (err) {
      console.error('Error with conversation:', err);
      toast.error('Failed to load chat');
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (convId: string) => {
    const { data: msgs } = await supabase
      .from('hiring_messages')
      .select(`
        id,
        sender_type,
        sender_id,
        content,
        created_at,
        sender:profiles(full_name, profile_photo_url)
      `)
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    setMessages((msgs || []) as Message[]);
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !conversationId || !user) return;

    const messageContent = newMessage.trim();
    setSending(true);
    try {
      const { error: sendError } = await supabase
        .from('hiring_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'staff',
          sender_id: user.id,
          content: messageContent
        });

      if (sendError) throw sendError;
      setNewMessage('');

      // Fetch sender name for the email
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      // Chat is push-only — no per-message email to the applicant (comms policy).
      // Send push notification to applicant (if they have PWA installed)
      supabase.functions.invoke('hiring-email-service', {
        body: {
          action: 'send_applicant_notification',
          conversation_id: conversationId,
          title: senderProfile?.full_name || 'Hiring Team',
          body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
          data: { type: 'hiring_message', conversation_id: conversationId }
        }
      }).catch(err => console.error('Failed to send applicant push notification:', err));

      // Also send push notification to other staff members (not the sender)
      // Get the application to find the location
      const { data: conv } = await supabase
        .from('hiring_conversations')
        .select('application:job_applications(location_id)')
        .eq('id', conversationId)
        .single();

      const locationId = (conv?.application as any)?.location_id;
      if (locationId) {
        // Notify other managers/admins at the location
        supabase.functions.invoke('send-push-notification', {
          body: {
            roles: ['admin', 'manager', 'general_manager'],
            location_id: locationId,
            title: `Hiring: Message sent`,
            body: `${senderProfile?.full_name || 'Staff'} messaged an applicant`,
            notification_type: 'chat_messages',
            sender_id: user.id, // Exclude sender from notification
            data: { type: 'hiring_message', conversation_id: conversationId }
          }
        }).catch(err => console.error('Failed to send push notification:', err))
      }

    } catch (err) {
      console.error('Error sending message:', err);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const copyApplicantLink = () => {
    if (!accessToken) return;
    const link = `${window.location.origin}/hiring-chat/${accessToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success('Link copied! Share with the applicant');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleScheduleInterview = async (date: Date, time: string, details: InterviewScheduleDetails) => {
    if (!conversationId || !user) return;

    setSending(true);
    try {
      // If rescheduling, cancel the previous interview first
      if (isRescheduling) {
        await cancelInterviewInternal(false);
      }

      await sendInterviewInvite({ applicationId, date, time, userId: user.id, modality: details.modality, meetingUrl: details.meetingUrl });

      toast.success(isRescheduling ? 'Interview rescheduled!' : 'Interview invitation sent!');
      setIsRescheduling(false);
    } catch (err) {
      console.error('Error scheduling interview:', err);
      toast.error('Failed to schedule interview');
      throw err;
    } finally {
      setSending(false);
    }
  };

  const cancelInterviewInternal = async (sendMessage = true) => {
    if (!user) return;
    await cancelInterview({ applicationId, userId: user.id, postMessage: sendMessage });
  };

  const handleCancelInterview = async () => {
    setSending(true);
    try {
      await cancelInterviewInternal(true);
      toast.success('Interview cancelled');
      setShowCancelDialog(false);
    } catch (err) {
      console.error('Error cancelling interview:', err);
      toast.error('Failed to cancel interview');
    } finally {
      setSending(false);
    }
  };

  const handleReschedule = () => {
    setIsRescheduling(true);
    setShowScheduleDialog(true);
  };

  const handleDeleteConversation = async () => {
    if (!conversationId) return;
    setSending(true);
    try {
      const { data: deletedConversation, error } = await supabase
        .from('hiring_conversations')
        .delete()
        .eq('id', conversationId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!deletedConversation) throw new Error('Conversation was not deleted');
      toast.success('Conversation deleted');
      setShowDeleteDialog(false);
      onConversationDeleted?.();
    } catch (err) {
      console.error('Error deleting hiring conversation:', err);
      toast.error('Failed to delete conversation');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[500px]">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Chat with {applicantName}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyApplicantLink}
              className="text-xs"
            >
              {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              Copy Link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(`/messages?tab=hiring&applicationId=${applicationId}`, '_blank')}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDeleteDialog(true)}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Share the link with the applicant so they can respond
        </p>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Start the conversation</p>
          </div>
        ) : (
          messages.map((message) => {
            const isInterviewInvite = message.content.startsWith('INTERVIEW_INVITE:');
            
            return (
              <div
                key={message.id}
                className={`flex ${message.sender_type === 'staff' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                    message.sender_type === 'staff'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {message.sender_type === 'applicant' && (
                    <p className="text-xs font-medium mb-1 opacity-70">{applicantName}</p>
                  )}
                  {isInterviewInvite ? (
                    <InterviewInviteMessage 
                      content={message.content} 
                      isApplicantView={false}
                      onCancel={() => setShowCancelDialog(true)}
                      onReschedule={handleReschedule}
                      responding={sending}
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                  <p className={`text-xs mt-1 ${
                    message.sender_type === 'staff' 
                      ? 'text-primary-foreground/60' 
                      : 'text-muted-foreground'
                  }`}>
                    {format(new Date(message.created_at), 'h:mm a')}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </CardContent>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsRescheduling(false);
              setShowScheduleDialog(true);
            }}
            title="Schedule Interview"
          >
            <CalendarPlus className="h-4 w-4" />
          </Button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={sending}
            className="text-sm"
          />
          <Button onClick={handleSend} disabled={!newMessage.trim() || sending} size="sm">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <InterviewScheduleDialog
        open={showScheduleDialog}
        onOpenChange={(open) => {
          setShowScheduleDialog(open);
          if (!open) setIsRescheduling(false);
        }}
        onSchedule={handleScheduleInterview}
        applicantName={applicantName}
        isRescheduling={isRescheduling}
        applicationId={applicationId}
        initial={isRescheduling ? (() => {
          const latest = [...messages].reverse().find(m => m.content.startsWith('INTERVIEW_INVITE:'));
          if (!latest) return null;
          try {
            const d = JSON.parse(latest.content.replace('INTERVIEW_INVITE:', ''));
            return { date: d.date, time: d.time, modality: d.modality || 'in_person', meetingUrl: d.meeting_url || null };
          } catch { return null; }
        })() : null}
      />

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Interview?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the scheduled interview with {applicantName}. They will be notified in the chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Interview</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleCancelInterview}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Interview
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the hiring conversation with {applicantName}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConversation}
              disabled={sending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete Conversation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
