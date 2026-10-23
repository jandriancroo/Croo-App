import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Send, CheckCircle, Image, Loader2, Clock, User, ArrowLeft, Zap, CheckCheck, Check, Ticket, Trash2 } from 'lucide-react';
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
  is_system?: boolean;
  profiles?: {
    full_name: string;
    profile_photo_url: string | null;
    email: string;
  };
}

const SYSTEM_PROFILE = {
  full_name: 'CrooHQ System',
  profile_photo_url: '/croo-logo.png',
  email: 'system@croohq.com',
};

const displayProfile = (ticket: { is_system?: boolean; profiles?: SupportTicket['profiles'] }) =>
  ticket.is_system ? SYSTEM_PROFILE : ticket.profiles;

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

const STATUS_DOT: Record<string, string> = {
  open: 'bg-yellow-500',
  in_progress: 'bg-blue-500',
  resolved: 'bg-green-500',
};

const formatTicketNum = (num: number) => `#SUP-${String(num).padStart(3, '0')}`;

function TicketTag({ ticket }: { ticket: SupportTicket }) {
  const resolved = ticket.status === 'resolved';
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${resolved ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary'}`}>
      <Ticket className="h-3 w-3 shrink-0" />
      <span className="shrink-0">{formatTicketNum(ticket.ticket_number)}</span>
      <span className="truncate opacity-80">· {CATEGORY_LABELS[ticket.category] || ticket.category}</span>
    </span>
  );
}

function TicketRow({
  ticket,
  onClick,
  active = false,
}: {
  ticket: SupportTicket;
  onClick: () => void;
  active?: boolean;
}) {
  const profile = displayProfile(ticket);
  const resolved = ticket.status === 'resolved';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group w-full flex items-center gap-3 px-3 py-3 transition-colors text-left cursor-pointer select-none ${
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
      }`}
    >
      <div className="relative shrink-0">
        <Avatar className={`h-12 w-12 ${resolved ? 'opacity-70' : ''}`}>
          <AvatarImage src={profile?.profile_photo_url || ''} />
          <AvatarFallback className="text-lg font-medium">
            {ticket.is_system ? 'C' : profile?.full_name?.charAt(0) || <User className="h-5 w-5" />}
          </AvatarFallback>
        </Avatar>
        {resolved && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-success ring-2 ring-background" title="Resolved">
            <Check className="h-2.5 w-2.5 text-background" strokeWidth={3.5} />
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`flex-1 min-w-0 truncate text-[15px] ${resolved ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground'}`}>
            {profile?.full_name || 'Unknown'}
          </p>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: false })}
          </span>
        </div>
        <p className={`truncate text-[13px] ${resolved ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}>{ticket.description}</p>
        <div className="mt-1 flex items-center gap-1.5 min-w-0">
          <TicketTag ticket={ticket} />
          {resolved && <span className="shrink-0 text-[11px] font-bold text-success">Resolved</span>}
        </div>
      </div>
    </div>
  );
}

export function SupportChatPanel() {
  const { isSuperAdmin } = useUserRole();
  // Panel is always narrow (rendered inside slideover), so use single-column list-or-chat layout
  const isMobile = true;
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
      const resolved = selectedTicket.status === 'resolved';
      const bubble = (own: boolean) => `max-w-[80%] rounded-2xl px-3 py-2 ${own ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`;
      // Chat view, DM look: header, cream thread, gray left / teal right bubbles
      return (
        <div className="flex flex-col h-full">
          <div className="px-3 py-2.5 border-b bg-card">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedTicket(null)}
                className="-ml-2 h-9 w-9 p-0"
                aria-label="Back to support chats"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Avatar className="h-9 w-9">
                <AvatarImage src={displayProfile(selectedTicket)?.profile_photo_url || ''} />
                <AvatarFallback>
                  {selectedTicket.is_system ? 'C' : <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{displayProfile(selectedTicket)?.full_name}</p>
                <div className="flex min-w-0 items-center gap-1.5">
                  <TicketTag ticket={selectedTicket} />
                  <span className={`shrink-0 text-[11px] font-bold ${resolved ? 'text-success' : selectedTicket.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground'}`}>
                    {resolved ? 'Resolved ✓' : selectedTicket.status === 'in_progress' ? 'In progress' : 'Open'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 min-h-0 bg-background">
            <div className="p-3 space-y-2">
              {/* Initial ticket as first message from user */}
              <div className="flex justify-start">
                <div className={bubble(false)}>
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
                      <span className="inline-flex items-center gap-1 text-xs text-primary mt-1">
                        <Image className="h-3 w-3" />
                        Open Screenshot
                      </span>
                    </a>
                  )}
                  <p className="text-[11px] mt-1 text-muted-foreground">
                    {format(new Date(selectedTicket.created_at), 'h:mm a')}
                  </p>
                </div>
              </div>

              {messages.map((msg) => {
                const isOwnMessage = msg.sender_id === currentUserId;
                const messageContent = (
                  <div className={bubble(isOwnMessage)}>
                    {!isOwnMessage && (
                      <p className="text-xs font-semibold mb-0.5">{msg.profiles?.full_name}</p>
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
                    <p className={`text-[11px] mt-1 ${isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
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
              {resolved && (
                <div className="flex items-center gap-2 py-2 text-[12px] font-semibold text-success">
                  <span className="h-px flex-1 bg-success/30" />
                  ✓ This ticket has been resolved
                  <span className="h-px flex-1 bg-success/30" />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Message Input */}
          {!resolved && (
            <div className="p-3 border-t bg-card space-y-2">
              {/* Quick replies as chips */}
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {QUICK_REPLIES.map((qr, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleQuickReply(qr)}
                    disabled={sending}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {qr.status === 'in_progress' && <Zap className="h-3 w-3 text-primary" />}
                    {qr.status === 'resolved' && <CheckCheck className="h-3 w-3 text-success" />}
                    {qr.label}
                  </button>
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
                  className="h-10 rounded-full"
                />
                <Button type="submit" disabled={sending || !newMessage.trim()} className="h-10 w-10 shrink-0 rounded-full p-0">
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          )}
          {resolved && (
            <div className="p-3 border-t bg-card">
              <div className="flex h-10 items-center rounded-full border border-border bg-muted/40 px-4 text-sm text-muted-foreground" aria-disabled="true">
                Reply to reopen…
              </div>
            </div>
          )}
        </div>
      );
    }

    // Ticket list: Open first, then Resolved
    const openTickets = tickets.filter((t) => t.status !== 'resolved');
    const resolvedTickets = tickets.filter((t) => t.status === 'resolved');
    const sectionLabel = 'px-4 pt-3 pb-1 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground';
    return (
      <div className="flex flex-col h-full">
        <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
          {openTickets.length > 0 && <p className={sectionLabel}>Open · {openTickets.length}</p>}
          <div className="divide-y divide-border/50">
            {openTickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} onClick={() => setSelectedTicket(ticket)} />
            ))}
          </div>
          {resolvedTickets.length > 0 && <p className={sectionLabel}>Resolved · {resolvedTickets.length}</p>}
          <div className="divide-y divide-border/50">
            {resolvedTickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} onClick={() => setSelectedTicket(ticket)} />
            ))}
          </div>
          {tickets.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No support chats yet.</p>}
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
          <div className="flex flex-wrap items-center gap-2">
            {(['open', 'in_progress', 'resolved'] as const).map((status) => (
              <Badge key={status} variant="outline" className={STATUS_COLORS[status]}>
                {tickets.filter(t => t.status === status).length} {status.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50 px-1">
            {tickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                onClick={() => setSelectedTicket(ticket)}
                active={selectedTicket?.id === ticket.id}
              />
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
                    <AvatarImage src={displayProfile(selectedTicket)?.profile_photo_url || ''} />
                    <AvatarFallback>
                      {selectedTicket.is_system ? 'C' : <User className="h-5 w-5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{displayProfile(selectedTicket)?.full_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTicketId(selectedTicket.ticket_number)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{displayProfile(selectedTicket)?.email}</p>
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
