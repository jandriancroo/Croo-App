import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle, User } from 'lucide-react';
import { format, isToday } from 'date-fns';

interface HiringConversation {
  id: string;
  application_id: string;
  access_token: string;
  updated_at: string;
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
}

export function HiringChatList({ onSelectConversation, selectedId }: HiringChatListProps) {
  const { currentLocation } = useLocation();
  const [conversations, setConversations] = useState<HiringConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentLocation?.id) {
      fetchConversations();
    }
  }, [currentLocation?.id]);

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

      // Fetch last message for each conversation
      const conversationsWithMessages = await Promise.all(
        (convs || []).map(async (conv: any) => {
          const { data: lastMsg } = await supabase
            .from('hiring_messages')
            .select('content, sender_type, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          return {
            ...conv,
            last_message: lastMsg || undefined,
            unread_count: 0 // Could implement read tracking later
          };
        })
      );

      setConversations(conversationsWithMessages);
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
    const date = new Date(dateString);
    return isToday(date) ? format(date, 'h:mm a') : format(date, 'MMM d');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-600';
      case 'reviewed': return 'bg-blue-500/10 text-blue-600';
      case 'interview': return 'bg-purple-500/10 text-purple-600';
      case 'hired': return 'bg-green-500/10 text-green-600';
      case 'rejected': return 'bg-red-500/10 text-red-600';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-10 w-10 rounded-full" />
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
    <div className="divide-y">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          onClick={() => onSelectConversation(conv)}
          className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
            selectedId === conv.id ? 'bg-muted' : ''
          }`}
        >
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-primary">
                {conv.application.full_name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{conv.application.full_name}</span>
                {conv.last_message && (
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatTime(conv.last_message.created_at)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className={`text-xs ${getStatusColor(conv.application.status)}`}>
                  {conv.application.status}
                </Badge>
              </div>
              {conv.last_message && (
                <p className="text-sm text-muted-foreground truncate mt-1">
                  {conv.last_message.sender_type === 'staff' ? 'You: ' : ''}
                  {conv.last_message.content}
                </p>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
