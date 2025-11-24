import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Reaction {
  id: string;
  reaction: string;
  user_id: string;
  profiles: {
    full_name: string;
  };
}

interface MessageReactionsProps {
  messageId: string;
  currentUserId: string | null;
}

const REACTION_EMOJIS: Record<string, string> = {
  thumbs_up: '👍',
  thumbs_down: '👎',
  smile: '😊',
  laugh: '😂',
  heart: '❤️',
  fire: '🔥',
};

export function MessageReactions({ messageId, currentUserId }: MessageReactionsProps) {
  const [reactions, setReactions] = useState<Reaction[]>([]);

  useEffect(() => {
    fetchReactions();

    const channel = supabase
      .channel(`reactions-${messageId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
          filter: `message_id=eq.${messageId}`
        },
        () => {
          fetchReactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [messageId]);

  const fetchReactions = async () => {
    try {
      const { data, error } = await supabase
        .from('message_reactions')
        .select('id, reaction, user_id, profiles(full_name)')
        .eq('message_id', messageId);

      if (error) throw error;
      setReactions(data as Reaction[]);
    } catch (error: any) {
      console.error('Error fetching reactions:', error);
    }
  };

  const handleToggleReaction = async (reactionType: string) => {
    if (!currentUserId) return;

    try {
      const existingReaction = reactions.find(
        r => r.reaction === reactionType && r.user_id === currentUserId
      );

      if (existingReaction) {
        const { error } = await supabase
          .from('message_reactions')
          .delete()
          .eq('id', existingReaction.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('message_reactions')
          .insert({
            message_id: messageId,
            user_id: currentUserId,
            reaction: reactionType
          });

        if (error) throw error;
      }
    } catch (error: any) {
      console.error('Error toggling reaction:', error);
      toast.error('Failed to update reaction');
    }
  };

  const groupedReactions = reactions.reduce((acc, reaction) => {
    if (!acc[reaction.reaction]) {
      acc[reaction.reaction] = [];
    }
    acc[reaction.reaction].push(reaction);
    return acc;
  }, {} as Record<string, Reaction[]>);

  if (Object.keys(groupedReactions).length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(groupedReactions).map(([type, reactionList]) => {
        const hasReacted = reactionList.some(r => r.user_id === currentUserId);
        const names = reactionList.map(r => r.profiles.full_name).join(', ');
        
        return (
          <Button
            key={type}
            variant={hasReacted ? 'secondary' : 'outline'}
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => handleToggleReaction(type)}
            title={names}
          >
            <span>{REACTION_EMOJIS[type]}</span>
            <span>{reactionList.length}</span>
          </Button>
        );
      })}
    </div>
  );
}