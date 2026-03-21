import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckCircle2, XCircle, Bell, Loader2, Clock } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { getDisplayName } from '@/utils/displayName';

interface AnnouncementStatsProps {
  chatId: string;
  announcementTitle?: string;
}

interface Member {
  user_id: string;
  profiles: {
    full_name: string;
    nickname: string | null;
    profile_photo_url: string | null;
  };
}

interface Read {
  user_id: string;
  opened_at: string;
}

export function AnnouncementStats({ chatId, announcementTitle }: AnnouncementStatsProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [reads, setReads] = useState<Read[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();

    const channel = supabase
      .channel(`announcement-stats-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcement_reads',
          filter: `chat_id=eq.${chatId}`
        },
        () => {
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  const fetchStats = async () => {
    try {
      const [membersRes, readsRes, messagesRes] = await Promise.all([
        supabase
          .from('chat_members')
          .select('user_id, profiles(full_name, nickname, profile_photo_url)')
          .eq('chat_id', chatId),
        supabase
          .from('announcement_reads')
          .select('user_id, opened_at')
          .eq('chat_id', chatId),
        // Get the first message to check if it's scheduled
        supabase
          .from('messages')
          .select('scheduled_at')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true })
          .limit(1)
      ]);

      if (membersRes.error) throw membersRes.error;
      if (readsRes.error) throw readsRes.error;

      setMembers(membersRes.data as Member[]);
      setReads(readsRes.data || []);
      setScheduledAt(messagesRes.data?.[0]?.scheduled_at || null);
    } catch (error: any) {
      console.error('Error fetching announcement stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = async () => {
    if (unreadMembers.length === 0) {
      toast.info('Everyone has read this announcement!');
      return;
    }

    setSendingReminder(true);
    try {
      const unreadUserIds = unreadMembers.map(m => m.user_id);
      
      const { error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: unreadUserIds,
          title: 'Reminder: Unread Announcement',
          body: announcementTitle || 'You have an unread announcement',
          notification_type: 'announcements',
          data: { chatId },
        },
      });

      if (error) throw error;

      toast.success(`Reminder sent to ${unreadUserIds.length} team member${unreadUserIds.length === 1 ? '' : 's'}`);
    } catch (error: any) {
      console.error('Error sending reminder:', error);
      toast.error('Failed to send reminder');
    } finally {
      setSendingReminder(false);
    }
  };

  const readUserIds = new Set(reads.map(r => r.user_id));
  const readMembers = members.filter(m => readUserIds.has(m.user_id));
  const unreadMembers = members.filter(m => !readUserIds.has(m.user_id));
  
  // Check if announcement is scheduled for the future
  const isScheduledForFuture = scheduledAt && new Date(scheduledAt) > new Date();

  if (loading) return null;

  return (
    <Card className="p-4 mb-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Announcement Stats</h3>
          <div className="text-sm text-muted-foreground">
            {readMembers.length} of {members.length} read
          </div>
        </div>

        {/* Show scheduled notice if future-dated */}
        {isScheduledForFuture && (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-500/10 rounded-lg p-2">
            <Clock className="h-4 w-4" />
            <span>Scheduled for {format(new Date(scheduledAt), 'MMM d, h:mm a')}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Read ({readMembers.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {readMembers.map((member) => (
                <div key={member.user_id} className="flex items-center gap-2 p-2 bg-muted rounded">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={member.profiles.profile_photo_url || undefined} />
                    <AvatarFallback className="text-xs">
                      {getDisplayName(member.profiles.full_name, member.profiles.nickname)?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{getDisplayName(member.profiles.full_name, member.profiles.nickname)}</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-start gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                Unread ({unreadMembers.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              {unreadMembers.map((member) => (
                <div key={member.user_id} className="flex items-center gap-2 p-2 bg-muted rounded">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={member.profiles.profile_photo_url || undefined} />
                    <AvatarFallback className="text-xs">
                      {getDisplayName(member.profiles.full_name, member.profiles.nickname)?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{getDisplayName(member.profiles.full_name, member.profiles.nickname)}</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Only show reminder button if not scheduled for future AND there are unread members */}
        {unreadMembers.length > 0 && !isScheduledForFuture && (
          <Button
            onClick={handleSendReminder}
            disabled={sendingReminder}
            variant="secondary"
            className="w-full gap-2"
          >
            {sendingReminder ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            Send Reminder to {unreadMembers.length} Unread
          </Button>
        )}
      </div>
    </Card>
  );
}