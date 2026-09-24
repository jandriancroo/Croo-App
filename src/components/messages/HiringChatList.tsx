import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle } from 'lucide-react';
import { DateTime } from 'luxon';

interface HiringConversation {
  id: string;
  application_id: string;
  access_token: string;
  updated_at: string;
  last_read_at: string | null;
  application: {
    full_name: string;
    email: string;
    status: string;
  };
  last_message?: {
    content: string;
    sender_type: string;
    created_at: string;
  };
  unread_count: number;
}

interface HiringChatListProps {
  onSelectConversation: (conversation: HiringConversation) => void;
  selectedId?: string;
  autoSelectApplicationId?: string | null;
}

export function HiringChatList({ onSelectConversation, selectedId, autoSelectApplicationId }: HiringChatListProps) {
  const { currentLocation } = useLocation();
  const [conversations, setConversations] = useState<HiringConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const autoSelectDone = useRef(false);

  useEffect(() => {
    if (currentLocation?.id) {
      fetchConversations();
    }
  }, [currentLocation?.id]);

  // Auto-select conversation by applicationId when it becomes available
  useEffect(() => {
    if (autoSelectApplicationId && !autoSelectDone.current && conversations.length > 0) {
      const target = conversations.find(c => c.application_id === autoSelectApplicationId);
      if (target) {
        onSelectConversation(target);
        autoSelectDone.current = true;
      }
    }
  }, [autoSelectApplicationId, conversations, onSelectConversation]);

  const fetchConversations = async () => {
    try {
      // Fetch conversations with application details
      const { data: convs, error } = await supabase
        .from('hiring_conversations')
        .select(`
          id,
          application_id,
          access_token,
          updated_at,
          last_read_at,
          application:job_applications!inner(
            full_name,
            email,
            status,
            location_id
          )
        `)
        .eq('application.location_id', currentLocation?.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const conversationIds = (convs || []).map(conv => conv.id);
      const { data: allMessages, error: messagesError } = conversationIds.length > 0
        ? await supabase
            .from('hiring_messages')
            .select('conversation_id, content, sender_type, created_at')
            .in('conversation_id', conversationIds)
            .order('created_at', { ascending: false })
        : { data: [], error: null };

      if (messagesError) throw messagesError;

      const messagesByConversation = new Map<string, typeof allMessages>();
      (allMessages || []).forEach(message => {
        const existing = messagesByConversation.get(message.conversation_id) || [];
        existing.push(message);
        messagesByConversation.set(message.conversation_id, existing);
      });

      const conversationsWithMessages = (convs || []).map(conv => {
        const conversationMessages = messagesByConversation.get(conv.id) || [];
        const lastReadMillis = conv.last_read_at ? Date.parse(conv.last_read_at) : 0;
        const unreadCount = conversationMessages.filter(message =>
          message.sender_type === 'applicant' && Date.parse(message.created_at) > lastReadMillis
        ).length;

        return {
          ...conv,
          last_message: conversationMessages[0] || undefined,
          unread_count: unreadCount,
        };
      });

      // Empty threads show only for active applicants; hide empty hired/rejected ones
      const ACTIVE = ['pending', 'interested', 'interviewing'];
      const filteredConversations = conversationsWithMessages.filter(
        conv => conv.last_message || ACTIVE.includes(conv.application?.status)
      );
      setConversations(filteredConversations);
    } catch (err) {
      console.error('Error fetching hiring conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  // Subscribe to new messages
  useEffect(() => {
    const channel = supabase
      .channel('hiring-messages-list')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'hiring_messages'
        },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentLocation?.id]);

  const formatTime = (dateString: string) => {
    const messageTime = DateTime.fromISO(dateString, { zone: 'utc' }).setZone('America/Los_Angeles');
    const today = DateTime.now().setZone('America/Los_Angeles');
    return messageTime.hasSame(today, 'day') ? messageTime.toFormat('h:mm a') : messageTime.toFormat('MMM d');
  };

  const formatPreview = (content: string) => {
    if (!content.startsWith('INTERVIEW_INVITE:')) return content;
    return 'Interview invitation';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-600';
      case 'interested': return 'bg-blue-500/10 text-blue-600';
      case 'interviewing': return 'bg-purple-500/10 text-purple-600';
      case 'hired': return 'bg-green-500/10 text-green-600';
      case 'rejected': return 'bg-red-500/10 text-red-600';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="font-medium">No hiring conversations</p>
        <p className="text-sm text-muted-foreground mt-1">
          Start a chat from an applicant's profile
        </p>
      </div>
    );
  }

  return (
      <div className="divide-y divide-border/60 overflow-y-auto flex-1">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectConversation(conv)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectConversation(conv);
              }
            }}
            className={`w-full min-h-[72px] text-left px-4 py-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              selectedId === conv.id
                ? 'bg-accent text-accent-foreground'
                : conv.unread_count > 0
                  ? 'bg-muted/60 hover:bg-muted/80'
                  : 'hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">
                  {conv.application.full_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`truncate text-[15px] ${conv.unread_count > 0 ? 'font-bold' : 'font-medium'}`}>
                    {conv.application.full_name}
                  </span>
                  <Badge variant="secondary" className={`h-5 shrink-0 px-1.5 text-[10px] font-medium capitalize ${getStatusColor(conv.application.status)}`}>
                    {conv.application.status}
                  </Badge>
                  {conv.last_message && (
                    <span className={`ml-auto shrink-0 whitespace-nowrap text-xs ${conv.unread_count > 0 ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
                      {formatTime(conv.last_message.created_at)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`min-w-0 flex-1 truncate text-sm ${conv.unread_count > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                    {conv.last_message ? formatPreview(conv.last_message.content) : 'No messages yet'}
                  </span>
                  {conv.unread_count > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" aria-label={`${conv.unread_count} unread messages`}>
                      {conv.unread_count > 99 ? '99+' : conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
  );
}
