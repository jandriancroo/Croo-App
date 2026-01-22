import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { MessageCircle, Trash2 } from 'lucide-react';
import { format, isToday } from 'date-fns';
import { toast } from 'sonner';

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<HiringConversation | null>(null);

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

      // Fetch last message for each conversation and filter out empty ones
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

      // Only show conversations that have at least one message
      const filteredConversations = conversationsWithMessages.filter(conv => conv.last_message);
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

  const handleDeleteClick = (e: React.MouseEvent, conv: HiringConversation) => {
    e.stopPropagation();
    setConversationToDelete(conv);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!conversationToDelete) return;

    try {
      // Delete messages first
      await supabase
        .from('hiring_messages')
        .delete()
        .eq('conversation_id', conversationToDelete.id);

      // Then delete the conversation
      const { error } = await supabase
        .from('hiring_conversations')
        .delete()
        .eq('id', conversationToDelete.id);

      if (error) throw error;

      toast.success('Conversation deleted');
      setConversations(prev => prev.filter(c => c.id !== conversationToDelete.id));
      
      // If we deleted the selected conversation, clear selection
      if (selectedId === conversationToDelete.id) {
        onSelectConversation(null as any);
      }
    } catch (err) {
      console.error('Error deleting conversation:', err);
      toast.error('Failed to delete conversation');
    } finally {
      setDeleteDialogOpen(false);
      setConversationToDelete(null);
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
    <>
      <div className="divide-y overflow-y-auto flex-1">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelectConversation(conv)}
            className={`w-full text-left p-3 hover:bg-muted/50 transition-colors cursor-pointer ${
              selectedId === conv.id ? 'bg-muted' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {conv.application.full_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{conv.application.full_name}</span>
                <Badge variant="secondary" className={`text-xs mt-1 ${getStatusColor(conv.application.status)}`}>
                  {conv.application.status}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleDeleteClick(e, conv)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this hiring conversation with {conversationToDelete?.application.full_name}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
