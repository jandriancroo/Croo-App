import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';

interface AnnouncementStatsProps {
  chatId: string;
}

interface Member {
  user_id: string;
  profiles: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

interface Read {
  user_id: string;
  opened_at: string;
}

export function AnnouncementStats({ chatId }: AnnouncementStatsProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [reads, setReads] = useState<Read[]>([]);
  const [loading, setLoading] = useState(true);

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
      const [membersRes, readsRes] = await Promise.all([
        supabase
          .from('chat_members')
          .select('user_id, profiles(full_name, profile_photo_url)')
          .eq('chat_id', chatId),
        supabase
          .from('announcement_reads')
          .select('user_id, opened_at')
          .eq('chat_id', chatId)
      ]);

      if (membersRes.error) throw membersRes.error;
      if (readsRes.error) throw readsRes.error;

      setMembers(membersRes.data as Member[]);
      setReads(readsRes.data || []);
    } catch (error: any) {
      console.error('Error fetching announcement stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const readUserIds = new Set(reads.map(r => r.user_id));
  const readMembers = members.filter(m => readUserIds.has(m.user_id));
  const unreadMembers = members.filter(m => !readUserIds.has(m.user_id));

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
                      {member.profiles.full_name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{member.profiles.full_name}</span>
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
                      {member.profiles.full_name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{member.profiles.full_name}</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </Card>
  );
}