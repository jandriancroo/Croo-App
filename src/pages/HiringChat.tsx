import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Send, MessageCircle, Loader2, Bell, BellOff } from 'lucide-react';
import { format } from 'date-fns';
import { AddToHomeScreenButton } from '@/components/AddToHomeScreenButton';
import { toast } from 'sonner';
import crooLogo from '@/assets/croo-logo.webp';
import { InterviewInviteMessage } from '@/components/hiring/InterviewInviteMessage';

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

interface ConversationData {
  id: string;
  application_id: string;
  application: {
    full_name: string;
    organization: {
      name: string;
      logo_url: string | null;
    };
  };
}

// VAPID key is served by the backend so it can never drift from the key the
// push sender signs with. See src/utils/pushVapid.ts.


export default function HiringChat() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const isStaffView = useMemo(() => searchParams.get('staff') === 'true', [searchParams]);

  const [conversation, setConversation] = useState<ConversationData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [respondingToMessageId, setRespondingToMessageId] = useState<string | null>(null);
  const [staffUserId, setStaffUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pushSetupDone = useRef(false);

  useEffect(() => {
    if (token) {
      fetchConversation();
    }
  }, [token]);

  useEffect(() => {
    let mounted = true;
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setStaffUserId(data.session?.user?.id ?? null);
    };
    loadSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Set up push notifications for applicants when they enable notifications
  useEffect(() => {
    if (isStaffView) return;
    if (!conversation || pushSetupDone.current) return;
    
    const setupApplicantPush = async () => {
      try {
        // Check if already subscribed
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          console.log('[Applicant Push] Not supported');
          return;
        }

        const permission = Notification.permission;
        if (permission !== 'granted') {
          console.log('[Applicant Push] Permission not granted');
          return;
        }

        setNotificationsEnabled(true);

        // Wait for service worker
        const registration = await navigator.serviceWorker.ready;
        
        // Check for existing subscription
        let subscription = await (registration as any).pushManager.getSubscription();
        
        if (!subscription) {
          console.log('[Applicant Push] Creating new subscription...');
          subscription = await (registration as any).pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

        const subscriptionData = JSON.stringify(subscription);

        // Save to applicant_push_subscriptions table
        const { error: saveError } = await supabase
          .from('applicant_push_subscriptions' as any)
          .upsert({
            conversation_id: conversation.id,
            subscription_data: subscriptionData,
            platform: 'web',
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'conversation_id,subscription_data'
          });

        if (saveError) {
          console.error('[Applicant Push] Failed to save subscription:', saveError);
        } else {
          console.log('[Applicant Push] Subscription saved successfully');
          pushSetupDone.current = true;
        }
      } catch (err) {
        console.error('[Applicant Push] Setup error:', err);
      }
    };

    setupApplicantPush();
  }, [conversation, notificationsEnabled, isStaffView]);

  useEffect(() => {
    if (!conversation) return;

    // Subscribe to new messages
    const channel = supabase
      .channel(`hiring-chat-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hiring_messages',
          filter: `conversation_id=eq.${conversation.id}`
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
  }, [conversation]);

  const fetchConversation = async () => {
    try {
      // Fetch conversation by token
      const { data: conv, error: convError } = await supabase
        .from('hiring_conversations')
        .select(`
          id,
          application_id,
          application:job_applications(
            full_name,
            organization:organizations(name, logo_url)
          )
        `)
        .eq('access_token', token)
        .single();

      if (convError || !conv) {
        setError('Conversation not found. Please check your link.');
        setLoading(false);
        return;
      }

      setConversation(conv as unknown as ConversationData);

      // Fetch messages
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
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true });

      setMessages((msgs || []) as Message[]);
    } catch (err) {
      console.error('Error fetching conversation:', err);
      setError('Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  const handleRespondToInterview = async (messageId: string, accepted: boolean) => {
    if (!conversation) return;
    
    setRespondingToMessageId(messageId);
    try {
      // Find the message and update the interview data
      const message = messages.find(m => m.id === messageId);
      if (!message) return;
      
      const jsonStr = message.content.replace('INTERVIEW_INVITE:', '');
      const interviewData = JSON.parse(jsonStr);
      interviewData.status = accepted ? 'accepted' : 'declined';
      
      // Update the message content
      const { error: msgError } = await supabase
        .from('hiring_messages')
        .update({ content: `INTERVIEW_INVITE:${JSON.stringify(interviewData)}` })
        .eq('id', messageId);
      
      if (msgError) throw msgError;
      
      // Update the application status
      const { error: appError } = await supabase
        .from('job_applications')
        .update({ 
          interview_status: accepted ? 'accepted' : 'declined',
          status: accepted ? 'interviewing' : 'interested'
        })
        .eq('id', conversation.application_id);
      
      if (appError) throw appError;
      
      // Update local state immediately
      setMessages(prev => prev.map(m => 
        m.id === messageId 
          ? { ...m, content: `INTERVIEW_INVITE:${JSON.stringify(interviewData)}` }
          : m
      ));
      
      // Send a response message
      await supabase.rpc('applicant_send_hiring_message', {
        _token: token,
        _content: accepted
          ? "I've accepted the interview invitation. Looking forward to meeting you!"
          : "I'm unable to make that time. Could we schedule for a different time?",
      });
      
      toast.success(accepted ? 'Interview accepted!' : 'Interview declined');
    } catch (err) {
      console.error('Error responding to interview:', err);
      toast.error('Failed to respond to interview');
    } finally {
      setRespondingToMessageId(null);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !conversation) return;

    const messageContent = newMessage.trim();
    setSending(true);
    try {
      if (isStaffView && !staffUserId) {
        toast.error('Please open this chat from within the app while logged in.');
        return;
      }

      const { error: sendError } = isStaffView
        ? await supabase
            .from('hiring_messages')
            .insert({
              conversation_id: conversation.id,
              sender_type: 'staff',
              sender_id: staffUserId,
              content: messageContent,
            })
        : await supabase.rpc('applicant_send_hiring_message', {
            _token: token,
            _content: messageContent,
          });

      if (sendError) throw sendError;
      setNewMessage('');

      // Only notify staff when an applicant sends a message
      if (!isStaffView) {
        const { data: application } = await supabase
          .from('job_applications')
          .select('organization_id, location_id')
          .eq('id', conversation.application_id)
          .single();

        if (application?.location_id) {
          supabase.functions.invoke('send-push-notification', {
            body: {
              roles: ['admin', 'manager', 'general_manager'],
              location_id: application.location_id,
              title: `${conversation.application.full_name}`,
              body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
              notification_type: 'chat_messages',
              data: { type: 'hiring_message', conversation_id: conversation.id }
            }
          }).catch(err => console.error('Failed to send push notification:', err));
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      toast.error('Notifications not supported on this device');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationsEnabled(true);
      
      // Set up push subscription immediately
      try {
        if ('serviceWorker' in navigator && 'PushManager' in window && conversation) {
          const registration = await navigator.serviceWorker.ready;
          let subscription = await (registration as any).pushManager.getSubscription();
          
          if (!subscription) {
            subscription = await (registration as any).pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
          }

          const subscriptionData = JSON.stringify(subscription);

          await supabase
            .from('applicant_push_subscriptions' as any)
            .upsert({
              conversation_id: conversation.id,
              subscription_data: subscriptionData,
              platform: 'web',
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'conversation_id,subscription_data'
            });

          pushSetupDone.current = true;
        }
      } catch (err) {
        console.error('[Applicant Push] Error setting up after permission:', err);
      }
      
      toast.success('Notifications enabled! You\'ll be notified of new messages.');
    } else {
      toast.error('Notifications were denied');
    }
  };

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotificationsEnabled(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Link Not Found</h2>
            <p className="text-muted-foreground">{error || 'This conversation link is invalid or has expired.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const orgLogo = conversation.application.organization?.logo_url;
  const orgName = conversation.application.organization?.name || 'Hiring Team';

  // If someone opens the staff link without being logged in, don't show the applicant UI.
  if (isStaffView && staffUserId === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Open in Croo</h2>
            <p className="text-muted-foreground">
              This is a staff-only chat link. Please open it from inside the Croo app while logged in.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={orgLogo || crooLogo} 
              alt={orgName} 
              className="h-10 w-10 rounded-lg object-contain"
            />
            <div>
              <h1 className="font-semibold">{orgName}</h1>
              <p className="text-xs text-muted-foreground">
                Hiring Chat {isStaffView ? '(Staff)' : '(Applicant)'}
              </p>
            </div>
          </div>
          {!isStaffView && (
            <Button
              variant="ghost"
              size="icon"
              onClick={requestNotifications}
              className={notificationsEnabled ? 'text-primary' : 'text-muted-foreground'}
            >
              {notificationsEnabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Install Banner */}
      {!isStaffView && !window.matchMedia('(display-mode: standalone)').matches && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <p className="text-sm text-primary-foreground/80">
              Add to your home screen to get notifications!
            </p>
            <AddToHomeScreenButton size="sm" variant="default">
              Install
            </AddToHomeScreenButton>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No messages yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                The hiring team will message you here
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const isInterviewInvite = message.content.startsWith('INTERVIEW_INVITE:');
              const isMine = message.sender_type === (isStaffView ? 'staff' : 'applicant');
              
              return (
                <div
                  key={message.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                      isMine
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {isStaffView && message.sender_type === 'staff' && message.sender && (
                      <p className="text-xs font-medium mb-1 opacity-70">
                        {message.sender.full_name}
                      </p>
                    )}
                    {isInterviewInvite ? (
                      <InterviewInviteMessage 
                        content={message.content} 
                        isApplicantView={!isStaffView}
                        onRespond={(accepted) => handleRespondToInterview(message.id, accepted)}
                        responding={respondingToMessageId === message.id}
                      />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    )}
                    <p className={`text-xs mt-1 ${
                      isMine 
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
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-card/50 backdrop-blur-sm sticky bottom-0">
        <div className="max-w-2xl mx-auto p-4">
          <div className="flex gap-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type your message..."
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={!newMessage.trim() || sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
