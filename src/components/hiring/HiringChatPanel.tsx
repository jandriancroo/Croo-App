import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, MessageCircle, Loader2, Copy, Check, ExternalLink, CalendarPlus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { InterviewScheduleDialog } from './InterviewScheduleDialog';
import { InterviewInviteMessage } from './InterviewInviteMessage';
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
}

export function HiringChatPanel({ applicationId, applicantName }: HiringChatPanelProps) {
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
  const [isRescheduling, setIsRescheduling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOrCreateConversation();
  }, [applicationId]);

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
      // Check for existing conversation
      const { data: existing } = await supabase
        .from('hiring_conversations')
        .select('id, access_token')
        .eq('application_id', applicationId)
        .single();

      if (existing) {
        setConversationId(existing.id);
        setAccessToken(existing.access_token);
        await fetchMessages(existing.id);
      } else {
        // Create new conversation
        const { data: newConv, error } = await supabase
          .from('hiring_conversations')
          .insert({ application_id: applicationId })
          .select('id, access_token')
          .single();

        if (error) throw error;
        
        setConversationId(newConv.id);
        setAccessToken(newConv.access_token);
      }
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

      // Send email notification to applicant
      supabase.functions.invoke('notify-hiring-message', {
        body: {
          conversationId,
          messageContent,
          senderName: senderProfile?.full_name || 'Hiring Team'
        }
      }).then(({ error }) => {
        if (error) console.error('Failed to send email notification:', error);
      });

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

  const handleScheduleInterview = async (date: Date, time: string) => {
    if (!conversationId || !user) return;
    
    const interviewData = {
      date: format(date, 'yyyy-MM-dd'),
      time,
      status: 'pending'
    };

    setSending(true);
    try {
      // If rescheduling, cancel the previous interview first
      if (isRescheduling) {
        await cancelInterviewInternal(false);
      }

      // Send interview invitation message
      const { error: msgError } = await supabase
        .from('hiring_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'staff',
          sender_id: user.id,
          content: `INTERVIEW_INVITE:${JSON.stringify(interviewData)}`
        });

      if (msgError) throw msgError;

      // Update application with interview details
      const { data: application, error: appError } = await supabase
        .from('job_applications')
        .update({
          interview_date: interviewData.date,
          interview_time: time,
          interview_status: 'pending',
          status: 'interviewing'
        })
        .eq('id', applicationId)
        .select('location:locations(name, address)')
        .single();

      if (appError) throw appError;

      // Get sender name for email
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const location = application?.location as any;

      // Send interview invite email with calendar attachment
      supabase.functions.invoke('send-interview-invite', {
        body: {
          conversationId,
          interviewDate: interviewData.date,
          interviewTime: time,
          locationName: location?.name || 'TBD',
          locationAddress: location?.address,
          scheduledByName: senderProfile?.full_name || 'Hiring Team'
        }
      }).then(({ error }) => {
        if (error) console.error('Failed to send interview invite email:', error);
      });

      toast.success(isRescheduling ? 'Interview rescheduled!' : 'Interview invitation sent!');
      setIsRescheduling(false);
    } catch (err) {
      console.error('Error scheduling interview:', err);
      toast.error('Failed to schedule interview');
    } finally {
      setSending(false);
    }
  };

  const cancelInterviewInternal = async (sendMessage = true) => {
    if (!conversationId || !user) return;

    // Find the latest pending/accepted interview message and update it
    const latestInterviewMsg = [...messages].reverse().find(m => 
      m.content.startsWith('INTERVIEW_INVITE:') && 
      !m.content.includes('"status":"cancelled"') &&
      !m.content.includes('"status":"declined"')
    );

    if (latestInterviewMsg && sendMessage) {
      // Parse and update status
      const jsonStr = latestInterviewMsg.content.replace('INTERVIEW_INVITE:', '');
      const data = JSON.parse(jsonStr);
      data.status = 'cancelled';

      // Send cancellation message
      await supabase
        .from('hiring_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'staff',
          sender_id: user.id,
          content: `INTERVIEW_INVITE:${JSON.stringify(data)}`
        });
    }

    // Clear interview from application
    await supabase
      .from('job_applications')
      .update({
        interview_date: null,
        interview_time: null,
        interview_status: null,
        status: 'pending'
      })
      .eq('id', applicationId);
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
              onClick={() => window.open(`/hiring-chat/${accessToken}`, '_blank')}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3" />
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
    </Card>
  );
}
