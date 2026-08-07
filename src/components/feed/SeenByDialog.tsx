import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Bell, Loader2, CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import type { FeedPost } from '@/hooks/useAnnouncementFeed';

interface Props {
  post: FeedPost | null;
  canRemind: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Member {
  user_id: string;
  full_name: string | null;
  nickname: string | null;
  profile_photo_url: string | null;
}

export function SeenByDialog({ post, canRemind, onOpenChange }: Props) {
  const open = !!post;
  const [members, setMembers] = useState<Member[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const audienceRes = post.location_id
          ? await supabase.from('user_locations').select('user_id').eq('location_id', post.location_id)
          : await supabase.from('brand_members').select('user_id').eq('brand_id', post.brand_id!);
        if (audienceRes.error) throw audienceRes.error;
        const userIds = Array.from(new Set((audienceRes.data ?? []).map((r: any) => r.user_id)));

        const [profilesRes, readsRes] = await Promise.all([
          userIds.length
            ? supabase.from('profiles').select('id, full_name, nickname, profile_photo_url, is_active, appears_on_schedule').in('id', userIds)
            : Promise.resolve({ data: [] as any[], error: null }),
          supabase.from('announcement_reads').select('user_id, opened_at').eq('post_id', post.id),
        ]);
        if (profilesRes.error) throw profilesRes.error;
        if (readsRes.error) throw readsRes.error;
        if (cancelled) return;

        const activeProfiles = ((profilesRes.data ?? []) as any[]).filter(
          p => p.is_active !== false && p.appears_on_schedule !== false && p.id !== post.author_id,
        );
        setMembers(activeProfiles.map(p => ({
          user_id: p.id,
          full_name: p.full_name,
          nickname: p.nickname,
          profile_photo_url: p.profile_photo_url,
        })));
        const rmap: Record<string, string> = {};
        (readsRes.data ?? []).forEach((r: any) => { rmap[r.user_id] = r.opened_at; });
        setReads(rmap);
      } catch (e) {
        console.error('[SeenByDialog] failed to load post views', e);
        toast.error('Failed to load post views');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [post?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!post) return null;

  const seenMembers = members.filter(m => reads[m.user_id]);
  const unseenMembers = members.filter(m => !reads[m.user_id]);

  const handleRemind = async () => {
    if (!unseenMembers.length) { toast.info('Everyone has seen this post'); return; }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: unseenMembers.map(m => m.user_id),
          title: 'Reminder: Unread announcement',
          body: (post.body || '').slice(0, 120) || 'You have an unread announcement',
          notification_type: 'announcements',
          data: { postId: post.id },
        },
      });
      if (error) throw error;
      toast.success(`Reminder sent to ${unseenMembers.length} ${unseenMembers.length === 1 ? 'person' : 'people'}`);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to send reminder');
    } finally {
      setSending(false);
    }
  };

  const name = (m: Member) => m.nickname || m.full_name || 'Unknown';
  const initials = (m: Member) => {
    const n = name(m);
    return n.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-base">Post views</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue="seen" className="w-full">
            <TabsList className="grid grid-cols-2 w-full rounded-none border-b h-10">
              <TabsTrigger value="seen" className="text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-500" />
                Seen ({seenMembers.length})
              </TabsTrigger>
              <TabsTrigger value="unseen" className="text-xs">
                <Circle className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                Not seen ({unseenMembers.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="seen" className="mt-0 max-h-[50vh] overflow-y-auto">
              {seenMembers.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">No one has seen this yet</div>
              ) : (
                <ul className="divide-y divide-border">
                  {seenMembers.map(m => (
                    <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={m.profile_photo_url ?? undefined} />
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(m)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{name(m)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(reads[m.user_id]), { addSuffix: true })}
                        </div>
                      </div>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="unseen" className="mt-0 max-h-[50vh] overflow-y-auto">
              {unseenMembers.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">Everyone has seen this!</div>
              ) : (
                <ul className="divide-y divide-border">
                  {unseenMembers.map(m => (
                    <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={m.profile_photo_url ?? undefined} />
                        <AvatarFallback className="text-xs bg-muted">{initials(m)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{name(m)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        )}

        {canRemind && unseenMembers.length > 0 && (
          <div className="border-t border-border p-3">
            <Button onClick={handleRemind} disabled={sending} className="w-full gap-2">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Send reminder to {unseenMembers.length} {unseenMembers.length === 1 ? 'person' : 'people'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
