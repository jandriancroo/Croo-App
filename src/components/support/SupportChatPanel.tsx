import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Send, CheckCircle, Image, Loader2, Clock, User, ArrowLeft, Zap, CheckCheck, ChevronDown, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { format, formatDistanceToNow } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';

interface SupportTicket {
  id: string;
  ticket_number: number;
  user_id: string;
  category: string;
  description: string;
  screenshot_url: string | null;
  occurrence_time: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  profiles?: {
    full_name: string;
    profile_photo_url: string | null;
    email: string;
  };
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
    profile_photo_url: string | null;
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

const STATUS_BORDER_COLORS: Record<string, string> = {
  open: 'border-l-yellow-500',
  in_progress: 'border-l-blue-500',
  resolved: 'border-l-green-500',
};


interface QuickReply {
  label: string;
  message: string;
  status?: 'in_progress' | 'resolved';
  variant?: 'default' | 'secondary' | 'outline';
}

const QUICK_REPLIES: QuickReply[] = [
  { label: "On it!", message: "Thanks for reporting this! I'm looking into it now.", status: 'in_progress', variant: 'default' },
  { label: "Need details", message: "Could you provide more details about when this happened and what you were doing?", variant: 'outline' },
  { label: "Thanks for patience", message: "Thanks for your patience while we work on this!", variant: 'outline' },
  { label: "Resolved", message: "This issue has been resolved. Please let us know if you experience any further problems!", status: 'resolved', variant: 'secondary' },
];

export function SupportChatPanel() {
  const { isSuperAdmin } = useUserRole();
  const isMobile = useIsMobile();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
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
      .channel('support-tickets-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        fetchTickets();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ticketChannel);
    };
  }, [isSuperAdmin]);

  useEffect(() => {
    if (selectedTicket) {
      fetchMessages(selectedTicket.id);

      // Subscribe to message updates for this ticket
      const messageChannel = supabase
        .channel(`support-messages-${selectedTicket.id}`)
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
        .select(`
          *,
          profiles!support_tickets_user_id_fkey (full_name, profile_photo_url, email)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTickets((data as SupportTicket[]) || []);
      
      // Update selected ticket if it exists
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
        .select(`
          *,
          profiles:sender_id (full_name, profile_photo_url)
        `)
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
      setNewMessage('');

      // Send push notification to the user who created the ticket
      if (selectedTicket.user_id && selectedTicket.user_id !== currentUserId) {
        supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: [selectedTicket.user_id],
            title: 'Support Team',
            body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
            notification_type: 'chat_messages',
            data: { type: 'support_message', ticket_id: selectedTicket.id }
          }
        }).catch(err => console.error('Failed to send push notification:', err));
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedTicket) return;

    setResolving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('support_tickets')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id,
        })
        .eq('id', selectedTicket.id);

      if (error) throw error;

      // Send resolution email
      await supabase.functions.invoke('support-email-service', {
        body: { action: 'send_support_resolution', payload: { ticketId: selectedTicket.id } }
      });

      toast.success('Ticket resolved! User notified via email and push.');
      fetchTickets();
    } catch (error) {
      console.error('Error resolving ticket:', error);
      toast.error('Failed to resolve ticket');
    } finally {
      setResolving(false);
    }
  };

  const handleQuickReply = async (quickReply: QuickReply) => {
    if (!selectedTicket || !currentUserId) return;

    setSending(true);
    try {
      // Send the message
      const { error: msgError } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: selectedTicket.id,
          sender_id: currentUserId,
          content: quickReply.message,
        });

      if (msgError) throw msgError;

      // Update status if specified
      if (quickReply.status) {
        const updateData: Record<string, unknown> = { status: quickReply.status };
        
        if (quickReply.status === 'resolved') {
          const { data: { user } } = await supabase.auth.getUser();
          updateData.resolved_at = new Date().toISOString();
          updateData.resolved_by = user?.id;
        }

        const { error: statusError } = await supabase
          .from('support_tickets')
          .update(updateData)
          .eq('id', selectedTicket.id);

        if (statusError) throw statusError;

        // Send resolution email if resolved
        if (quickReply.status === 'resolved') {
          await supabase.functions.invoke('support-email-service', {
            body: { action: 'send_support_resolution', payload: { ticketId: selectedTicket.id } }
          });
          toast.success('Ticket resolved! User notified.');
        } else {
          toast.success('Status updated to In Progress');
        }
        
        fetchTickets();
      }
    } catch (error) {
      console.error('Error with quick reply:', error);
      toast.error('Failed to send quick reply');
    } finally {
      setSending(false);
    }
  };

  const handleUnsendMessage = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('support_messages')
        .delete()
        .eq('id', messageId);

      if (error) throw error;
      
      setMessages(prev => prev.filter(m => m.id !== messageId));
      toast.success('Message unsent');
    } catch (error) {
      console.error('Error unsending message:', error);
      toast.error('Failed to unsend message');
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

  // Mobile: show either list OR chat, not both
  if (isMobile) {
    if (selectedTicket) {
      // Show chat view with back button
      return (
        <div className="flex flex-col h-full">
          {/* Compact Ticket Header with Back Button */}
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTicket(null)}
                  className="gap-1 -ml-2 h-8 px-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={selectedTicket.profiles?.profile_photo_url || ''} />
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{selectedTicket.profiles?.full_name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatTicketId(selectedTicket.ticket_number)}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-xs w-fit">{CATEGORY_LABELS[selectedTicket.category]}</Badge>
                </div>
              </div>
              {/* Status Indicator - icon only */}
              <div className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${
                selectedTicket.status === 'resolved' 
                  ? 'bg-green-500/20 text-green-400' 
                  : selectedTicket.status === 'in_progress'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-yellow-500/20 text-yellow-400'
              }`} title={selectedTicket.status === 'resolved' ? 'Resolved' : selectedTicket.status === 'in_progress' ? 'In Progress' : 'Open'}>
                {selectedTicket.status === 'resolved' ? <CheckCheck className="h-4 w-4" /> : 
                 selectedTicket.status === 'in_progress' ? <Zap className="h-4 w-4" /> : 
                 <Clock className="h-4 w-4" />}
              </div>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-3">
              {/* Initial ticket as first message from user */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg p-2.5 bg-primary text-primary-foreground">
                  <p className="text-sm">{selectedTicket.description}</p>
                  {selectedTicket.screenshot_url && (
                    <a
                      href={selectedTicket.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block mt-2"
                    >
                      <img
                        src={selectedTicket.screenshot_url}
                        alt="Support ticket screenshot"
                        loading="lazy"
                        className="rounded-md max-w-full"
                      />
                      <span className="inline-flex items-center gap-1 text-xs text-primary-foreground/80 hover:text-primary-foreground mt-1">
                        <Image className="h-3 w-3" />
                        Open Screenshot
                      </span>
                    </a>
                  )}
                  <p className="text-xs mt-1 text-primary-foreground/70">
                    {format(new Date(selectedTicket.created_at), 'h:mm a')}
                  </p>
                </div>
              </div>
              
              {messages.map((msg) => {
                const isOwnMessage = msg.sender_id === currentUserId;
                const messageContent = (
                  <div
                    className={`max-w-[85%] rounded-lg p-2.5 ${
                      isOwnMessage
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {!isOwnMessage && (
                      <p className="text-xs font-medium mb-1">{msg.profiles?.full_name}</p>
                    )}
                    {msg.content && <p className="text-sm">{msg.content}</p>}
                    {msg.image_url && (
                      <img
                        src={msg.image_url}
                        alt="Message attachment"
                        loading="lazy"
                        className="mt-2 rounded max-w-full"
                      />
                    )}
                    <p className={`text-xs mt-1 ${isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {format(new Date(msg.created_at), 'h:mm a')}
                    </p>
                  </div>
                );

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                  >
                    {isOwnMessage ? (
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          {messageContent}
                        </ContextMenuTrigger>
                        <ContextMenuContent className="bg-background">
                          <ContextMenuItem
                            onClick={() => handleUnsendMessage(msg.id)}
                            className="text-destructive focus:text-destructive cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Unsend
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ) : (
                      messageContent
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Message Input */}
          {selectedTicket.status !== 'resolved' && (
            <div className="p-3 border-t space-y-2">
              {/* Quick Replies Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs h-7" disabled={sending}>
                    Quick Reply
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-background">
                  {QUICK_REPLIES.map((qr, idx) => (
                    <DropdownMenuItem
                      key={idx}
                      onClick={() => handleQuickReply(qr)}
                      className="text-xs cursor-pointer"
                    >
                      {qr.status === 'in_progress' && <Zap className="h-3 w-3 mr-2 text-blue-400" />}
                      {qr.status === 'resolved' && <CheckCheck className="h-3 w-3 mr-2 text-green-400" />}
                      {!qr.status && <span className="w-5" />}
                      {qr.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
                  placeholder="Type your response..."
                  disabled={sending}
                  className="h-9"
                />
                <Button type="submit" disabled={sending || !newMessage.trim()} className="h-9 w-9 p-0">
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
            <div className="p-3 border-t text-center text-sm text-muted-foreground">
              ✅ This ticket has been resolved
            </div>
          )}
        </div>
      );
    }

    // Show ticket list (full width on mobile)
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b bg-card">
          <h2 className="font-semibold text-lg">Support Tickets</h2>
          <p className="text-sm text-muted-foreground">
            <span className="text-yellow-500 font-medium">{tickets.filter(t => t.status === 'open').length} open</span>
            <span className="mx-2">•</span>
            <span className="text-blue-500 font-medium">{tickets.filter(t => t.status === 'in_progress').length} in progress</span>
            <span className="mx-2">•</span>
            <span className="text-green-500 font-medium">{tickets.filter(t => t.status === 'resolved').length} resolved</span>
          </p>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50 px-1">
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className={`w-full px-3 py-3 text-left transition-all border-l-4 ${STATUS_BORDER_COLORS[ticket.status]} hover:bg-muted/50`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {formatTicketId(ticket.ticket_number)}
                      </span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[ticket.status]}`}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold truncate">{ticket.profiles?.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[ticket.category] || ticket.category}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Desktop: side-by-side layout
  return (
    <div className="flex h-full">
      {/* Ticket List */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-4 border-b bg-card">
          <h2 className="font-semibold text-lg">Support Tickets</h2>
          <p className="text-sm text-muted-foreground">
            <span className="text-yellow-500 font-medium">{tickets.filter(t => t.status === 'open').length} open</span>
            <span className="mx-2">•</span>
            <span className="text-blue-500 font-medium">{tickets.filter(t => t.status === 'in_progress').length} in progress</span>
          </p>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className={`w-full p-3 text-left transition-all rounded-xl border-l-4 ${STATUS_BORDER_COLORS[ticket.status]} ${
                  selectedTicket?.id === ticket.id
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {formatTicketId(ticket.ticket_number)}
                      </span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[ticket.status]}`}>
                        {ticket.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold truncate">{ticket.profiles?.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[ticket.category] || ticket.category}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedTicket ? (
          <>
            {/* Ticket Header */}
            <div className="p-4 border-b space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={selectedTicket.profiles?.profile_photo_url || ''} />
                    <AvatarFallback>
                      <User className="h-5 w-5" />
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{selectedTicket.profiles?.full_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTicketId(selectedTicket.ticket_number)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{selectedTicket.profiles?.email}</p>
                  </div>
                </div>
                {selectedTicket.status !== 'resolved' && (
                  <Button
                    onClick={handleResolve}
                    disabled={resolving}
                    className="gap-2"
                    variant="default"
                  >
                    {resolving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4" />
                    )}
                    Mark Resolved
                  </Button>
                )}
              </div>
              
              {/* Ticket Details */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  <Badge variant="outline">{CATEGORY_LABELS[selectedTicket.category]}</Badge>
                  {selectedTicket.occurrence_time && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(selectedTicket.occurrence_time), 'MMM d, h:mm a')}
                    </span>
                  )}
                </div>
                <p className="text-sm">{selectedTicket.description}</p>
                {selectedTicket.screenshot_url && (
                  <a
                    href={selectedTicket.screenshot_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Image className="h-3 w-3" />
                    View Screenshot
                  </a>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {/* Status Indicator */}
                <div className="flex justify-center">
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedTicket.status]} border`}>
                    {selectedTicket.status === 'open' && '🟡 Open - Awaiting Response'}
                    {selectedTicket.status === 'in_progress' && '🔵 In Progress - Being Reviewed'}
                    {selectedTicket.status === 'resolved' && '✅ Resolved'}
                  </div>
                </div>
                
                {messages.map((msg) => {
                  const isOwnMessage = msg.sender_id === currentUserId;
                  const messageContent = (
                    <div
                      className={`max-w-[70%] rounded-lg p-3 ${
                        isOwnMessage
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {!isOwnMessage && (
                        <p className="text-xs font-medium mb-1">{msg.profiles?.full_name}</p>
                      )}
                      {msg.content && <p className="text-sm">{msg.content}</p>}
                      {msg.image_url && (
                        <img
                          src={msg.image_url}
                          alt="Attachment"
                          className="mt-2 rounded max-w-full"
                        />
                      )}
                      <p className={`text-xs mt-1 ${isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {format(new Date(msg.created_at), 'h:mm a')}
                      </p>
                    </div>
                  );

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                    >
                      {isOwnMessage ? (
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            {messageContent}
                          </ContextMenuTrigger>
                          <ContextMenuContent className="bg-background">
                            <ContextMenuItem
                              onClick={() => handleUnsendMessage(msg.id)}
                              className="text-destructive focus:text-destructive cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Unsend
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ) : (
                        messageContent
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message Input */}
            {selectedTicket.status !== 'resolved' && (
              <div className="p-4 border-t space-y-3">
                {/* Quick Replies */}
                <div className="flex flex-wrap gap-2">
                  {QUICK_REPLIES.map((qr, idx) => (
                    <Button
                      key={idx}
                      variant={qr.variant || 'outline'}
                      size="sm"
                      onClick={() => handleQuickReply(qr)}
                      disabled={sending}
                      className="text-xs"
                    >
                      {qr.label}
                      {qr.status === 'in_progress' && <span className="ml-1 text-blue-400">→ In Progress</span>}
                      {qr.status === 'resolved' && <span className="ml-1 text-green-400">→ Resolved</span>}
                    </Button>
                  ))}
                </div>
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
                    placeholder="Type your response..."
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
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Select a ticket to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
