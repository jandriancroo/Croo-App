import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, MessageCircle, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

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

    setSending(true);
    try {
      const { error: sendError } = await supabase
        .from('hiring_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'staff',
          sender_id: user.id,
          content: newMessage.trim()
        });

      if (sendError) throw sendError;
      setNewMessage('');
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
          messages.map((message) => (
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
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p className={`text-xs mt-1 ${
                  message.sender_type === 'staff' 
                    ? 'text-primary-foreground/60' 
                    : 'text-muted-foreground'
                }`}>
                  {format(new Date(message.created_at), 'h:mm a')}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </CardContent>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
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
    </Card>
  );
}
