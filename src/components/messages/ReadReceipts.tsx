import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Check, CheckCheck, Eye } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { getDisplayName } from '@/utils/displayName';

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
    profile_photo_url: string | null;
  };
}

interface ChatMember {
  user_id: string;
  profiles: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

export function ReadReceipts({ messageId, senderId, currentUserId, chatId }: ReadReceiptsProps) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [allMembers, setAllMembers] = useState<ChatMember[]>([]);
  const [open, setOpen] = useState(false);

  // Only fetch full data when popover opens
  useEffect(() => {
    if (open) {
      fetchReceipts();
    }
  }, [open, messageId]);

  // Lightweight check for read status indicator
  useEffect(() => {
    if (senderId !== currentUserId) return;
    fetchReceipts();
  }, [messageId]);

  const fetchReceipts = async () => {
    try {
      const [receiptsRes, membersRes] = await Promise.all([
        supabase
          .from('message_read_receipts')
          .select('user_id, read_at, profiles(full_name, nickname, profile_photo_url, is_active, appears_on_schedule)')
          .eq('message_id', messageId),
        supabase
          .from('chat_members')
          .select('user_id, profiles(full_name, nickname, profile_photo_url, is_active, appears_on_schedule)')
          .eq('chat_id', chatId)
      ]);

      if (receiptsRes.error) throw receiptsRes.error;
      
      // Filter out inactive and not-on-schedule users
      const filterActive = (items: any[]) => items.filter((item: any) => 
        item.profiles?.is_active !== false && item.profiles?.appears_on_schedule !== false
      );
      
      setReceipts(filterActive(receiptsRes.data || []) as Receipt[]);
      setAllMembers(filterActive(membersRes.data || []) as ChatMember[]);
    } catch (error: any) {
      console.error('Error fetching receipts:', error);
    }
  };

  // Only show read receipt UI for the sender
  if (senderId !== currentUserId) return null;

  const readUserIds = new Set(receipts.map(r => r.user_id));
  const isReadByOthers = receipts.some(r => r.user_id !== senderId);
  
  // Exclude sender from both lists
  const readByOthers = receipts.filter(r => r.user_id !== senderId);
  const unreadMembers = allMembers.filter(m => m.user_id !== senderId && !readUserIds.has(m.user_id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
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
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end" side="top">
        <div className="max-h-64 overflow-y-auto">
          {/* Read section */}
          {readByOthers.length > 0 && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border flex items-center gap-1.5">
                <Eye className="h-3 w-3" />
                Read · {readByOthers.length}
              </div>
              {readByOthers.map(r => (
                <div key={r.user_id} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={r.profiles.profile_photo_url || undefined} />
                    <AvatarFallback className="text-[10px]">{getDisplayName(r.profiles.full_name, r.profiles.nickname)?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm truncate flex-1">{getDisplayName(r.profiles.full_name, r.profiles.nickname)}</span>
                  <CheckCheck className="h-3 w-3 text-primary flex-shrink-0" />
                </div>
              ))}
            </div>
          )}

          {/* Unread section */}
          {unreadMembers.length > 0 && (
            <div>
              <div className={cn(
                "px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5",
                readByOthers.length > 0 && "border-t border-border"
              )}>
                Unread · {unreadMembers.length}
              </div>
              {unreadMembers.map(m => (
                <div key={m.user_id} className="flex items-center gap-2.5 px-3 py-2 opacity-50">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={m.profiles.profile_photo_url || undefined} />
                    <AvatarFallback className="text-[10px]">{getDisplayName(m.profiles.full_name, m.profiles.nickname)?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm truncate flex-1">{getDisplayName(m.profiles.full_name, m.profiles.nickname)}</span>
                  <Check className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </div>
              ))}
            </div>
          )}

          {readByOthers.length === 0 && unreadMembers.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No recipients yet
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
