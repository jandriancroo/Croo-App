import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Send, Plus, Loader2, ArrowLeft, ChevronDown } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { CreateTicketDialog } from './CreateTicketDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SupportTicket {
  id: string;
  ticket_number: number;
  category: string;
  description: string;
  screenshot_url: string | null;
  occurrence_time: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
  resolved_at: string | null;
}

interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  profiles?: {
    full_name: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  ui_glitch: 'UI Glitch',
  broken_feature: 'Broken Feature',
  login_issues: 'Login Issues',
  data_sync_issues: 'Data/Sync Issues',
  notification_issues: 'Notification Issues',
  scheduling_issues: 'Scheduling Issues',
  other: 'Other',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
  in_progress: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  resolved: 'bg-green-500/20 text-green-500 border-green-500/30',
};

export function UserSupportView() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || null);
    };
    fetchUser();
  }, []);

  useEffect(() => {
    fetchTickets();

    // Subscribe to ticket updates
    const ticketChannel = supabase
      .channel('user-support-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        fetchTickets();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ticketChannel);
    };
  }, []);

  useEffect(() => {
    if (selectedTicket) {
      fetchMessages(selectedTicket.id);

      const messageChannel = supabase
        .channel(`user-support-messages-${selectedTicket.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${selectedTicket.id}`,
        }, () => {
          fetchMessages(selectedTicket.id);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(messageChannel);
      };
    }
  }, [selectedTicket?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchTickets = async () => {
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTickets((data as SupportTicket[]) || []);
      
      if (selectedTicket) {
        const updated = data?.find(t => t.id === selectedTicket.id);
        if (updated) setSelectedTicket(updated as SupportTicket);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (ticketId: string) => {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select(`*, profiles:sender_id (full_name)`)
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as SupportMessage[]) || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedTicket || !currentUserId) return;

    const messageContent = newMessage.trim();
    setSending(true);
    try {
      const { error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: selectedTicket.id,
          sender_id: currentUserId,
          content: messageContent,
        });

      if (error) throw error;

      // Notify support admins about new message from user
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', currentUserId)
          .single();

        await supabase.functions.invoke('notify-support-ticket', {
          body: {
            ticket_id: selectedTicket.id,
            event_type: 'new_message',
            message_content: messageContent,
            sender_name: profile?.full_name || 'User',
          },
        });
      } catch (notifyError) {
        console.error('Error notifying support team:', notifyError);
      }

      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const formatTicketId = (num: number) => `#SUP-${String(num).padStart(3, '0')}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show ticket list
  if (!selectedTicket) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold">My Support Tickets</h2>
            <p className="text-xs text-muted-foreground">
              {tickets.filter(t => t.status !== 'resolved').length} open tickets
            </p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Ticket
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <p>No support tickets yet</p>
              <Button onClick={() => setIsCreateOpen(true)} variant="link" className="mt-2">
                Create your first ticket
              </Button>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => setSelectedTicket(ticket)}
                  className="w-full p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-medium">
                      {formatTicketId(ticket.ticket_number)}
                    </span>
                    <Badge variant="outline" className={STATUS_COLORS[ticket.status]}>
                      {ticket.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium">{CATEGORY_LABELS[ticket.category]}</p>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {ticket.description}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                  </p>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <CreateTicketDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
      </div>
    );
  }

  // Show ticket conversation
  return (
    <div className="flex flex-col h-full">
      {/* Header with Ticket Dropdown */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSelectedTicket(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-auto p-1 gap-2 font-normal max-w-full">
                  <span className="font-mono text-sm shrink-0">{formatTicketId(selectedTicket.ticket_number)}</span>
                  <Badge variant="outline" className={`${STATUS_COLORS[selectedTicket.status]} shrink-0`}>
                    {selectedTicket.status.replace('_', ' ')}
                  </Badge>
                  <Badge variant="secondary" className="text-xs truncate max-w-[120px]">
                    {CATEGORY_LABELS[selectedTicket.category]}
                  </Badge>
                  <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {tickets.map((ticket) => (
                  <DropdownMenuItem
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket)}
                    className="flex items-center justify-between"
                  >
                    <span className="font-mono text-xs">{formatTicketId(ticket.ticket_number)}</span>
                    <Badge variant="outline" className={`text-xs ${STATUS_COLORS[ticket.status]}`}>
                      {ticket.status.replace('_', ' ')}
                    </Badge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No messages yet. We'll respond to your ticket soon!
            </p>
          )}
          {messages.map((msg) => {
            const isOwnMessage = msg.sender_id === currentUserId;
            return (
              <div
                key={msg.id}
                className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-lg p-3 ${
                    isOwnMessage
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {!isOwnMessage && (
                    <p className="text-xs font-medium mb-1">Support Team</p>
                  )}
                  {msg.content && <p className="text-sm">{msg.content}</p>}
                  <p className={`text-xs mt-1 ${isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {format(new Date(msg.created_at), 'h:mm a')}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Message Input */}
      {selectedTicket.status !== 'resolved' && (
        <div className="p-4 border-t">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex gap-2"
          >
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              disabled={sending}
            />
            <Button type="submit" disabled={sending || !newMessage.trim()}>
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      )}

      {selectedTicket.status === 'resolved' && (
        <div className="p-4 border-t bg-green-500/10 text-center">
          <p className="text-sm text-green-600">
            ✓ This ticket has been resolved
          </p>
        </div>
      )}
    </div>
  );
}
