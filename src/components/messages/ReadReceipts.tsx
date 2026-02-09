import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Check, CheckCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUserRole } from '@/hooks/useUserRole';

interface ReadReceiptsProps {
  messageId: string;
  senderId: string;
  currentUserId: string | null;
  chatId: string;
}

interface Receipt {
  user_id: string;
  read_at: string;
  profiles: {
    full_name: string;
  };
}

export function ReadReceipts({ messageId, senderId, currentUserId, chatId }: ReadReceiptsProps) {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);

  useEffect(() => {
    fetchReceipts();
    markAsRead();

    const channel = supabase
      .channel(`receipts-${messageId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_read_receipts',
          filter: `message_id=eq.${messageId}`
        },
        () => {
          fetchReceipts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [messageId]);

  const fetchReceipts = async () => {
    try {
      const [receiptsRes, membersRes] = await Promise.all([
        supabase
          .from('message_read_receipts')
          .select('user_id, read_at, profiles(full_name)')
          .eq('message_id', messageId),
        supabase
          .from('chat_members')
          .select('user_id', { count: 'exact' })
          .eq('chat_id', chatId)
      ]);

      if (receiptsRes.error) throw receiptsRes.error;
      setReceipts(receiptsRes.data as Receipt[]);
      setTotalMembers(membersRes.count || 0);
    } catch (error: any) {
      console.error('Error fetching receipts:', error);
    }
  };

  const markAsRead = async () => {
    if (!currentUserId || senderId === currentUserId) return;

    try {
      await supabase
        .from('message_read_receipts')
        .insert({
          message_id: messageId,
          user_id: currentUserId
        });
    } catch (error: any) {
      // Ignore duplicate errors
      if (!error.message?.includes('duplicate')) {
        console.error('Error marking as read:', error);
      }
    }
  };

  // Only show receipts for sent messages from admins and higher
  if (senderId !== currentUserId) return null;
  if (roleLoading || !isAdmin) return null;

  const readCount = receipts.length;
  const isReadByOthers = receipts.some(r => r.user_id !== senderId);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            {isReadByOthers ? (
              <>
                <CheckCheck className="h-3 w-3 text-primary" />
                <span className="text-primary">Read</span>
              </>
            ) : (
              <>
                <Check className="h-3 w-3" />
                <span>Sent</span>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            {isReadByOthers ? (
              <>
                <p className="font-semibold mb-1">Read by {readCount - 1}:</p>
                {receipts
                  .filter(r => r.user_id !== senderId)
                  .slice(0, 5)
                  .map(r => (
                    <p key={r.user_id}>{r.profiles.full_name}</p>
                  ))}
                {readCount > 6 && <p className="text-muted-foreground">+{readCount - 6} more</p>}
              </>
            ) : (
              <p>Message sent</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}