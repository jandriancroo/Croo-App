import { useEffect, useRef, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAnnouncementFeed } from '@/hooks/useAnnouncementFeed';
import { useAuth } from '@/lib/auth';
import { whenInviteAllowed } from '@/lib/startupSequence';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Mounted only by the Dash system-alert coordinator; shares Chat's read records. */
export function AnnouncementsPopup({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const { posts, markSeen } = useAnnouncementFeed();
  const [openId, setOpenId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const post = posts.find(p => p.id === openId);
  const next = posts.filter(p => p.is_announcement && !p.seen_by_me && p.author_id !== user?.id && !completed.includes(p.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  useEffect(() => { setOpenId(null); setCompleted([]); }, [user?.id]);
  useEffect(() => {
    if (!enabled) { setOpenId(null); return; }
    if (openId || !next) return;
    return whenInviteAllowed(() => setOpenId(next.id));
  }, [enabled, openId, next?.id]);
  useEffect(() => {
    if (post?.seen_by_me) setOpenId(null);
  }, [post?.seen_by_me]);

  const finish = async () => {
    if (!post || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      if (!await markSeen(post.id)) { toast.error('Could not save your response. Please try again.'); return; }
      setCompleted(ids => [...ids, post.id]);
      setOpenId(null);
    } finally { saving.current = false; setBusy(false); }
  };
  // Only visible time counts, not time spent in another tab or with the app backgrounded.
  useEffect(() => {
    if (!post || !enabled || post.require_confirm) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => void finish(), 5000);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [post?.id, enabled, markSeen]);

  if (!post || !enabled) return null;
  return <Dialog open onOpenChange={() => { /* Reading, not dismissal, advances the queue. */ }}>
    <DialogContent className="duo-popup max-w-md rounded-lg [&>button]:hidden" onEscapeKeyDown={e => e.preventDefault()} onPointerDownOutside={e => e.preventDefault()}>
      <DialogHeader className="pr-8">
        <Megaphone className="h-6 w-6 text-primary" />
        <DialogTitle>{post.subject || 'Announcement'}</DialogTitle>
        <DialogDescription>{post.author?.nickname || post.author?.full_name || 'Your team'}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[55dvh] overflow-y-auto space-y-3" onScroll={e => {
        const el = e.currentTarget;
        if (!post.require_confirm && document.visibilityState === 'visible' && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) void finish();
      }}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.body}</p>
        {post.media.map((media, i) => media.type === 'image'
          ? <img key={i} src={media.url} alt={media.name || 'Announcement attachment'} className="w-full rounded-lg" />
          : <a key={i} href={media.url} target="_blank" rel="noopener noreferrer" className="block text-primary underline">{media.name || 'View attachment'}</a>)}
      </div>
      <Button disabled={busy} onClick={() => void finish()}>{busy ? 'Saving…' : "I've read this"}</Button>
    </DialogContent>
  </Dialog>;
}
