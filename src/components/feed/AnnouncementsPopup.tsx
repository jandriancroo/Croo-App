import { useEffect, useRef, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAnnouncementFeed } from '@/hooks/useAnnouncementFeed';
import { useAuth } from '@/lib/auth';
import { whenInviteAllowed } from '@/lib/startupSequence';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const MAX_FAILED_LAUNCHES = 3;
const dismissedKey = (uid: string) => `croo-ann-dismissed:${uid}`;
const failedKey = (uid: string) => `croo-ann-ack-failed:${uid}`;
function readJson<T>(store: Storage, key: string, fallback: T): T {
  try { const raw = store.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function writeJson(store: Storage, key: string, value: unknown) {
  try { store.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** Mounted only by the Dash system-alert coordinator; shares Chat's read records. */
export function AnnouncementsPopup({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const uid = user?.id ?? 'anon';
  const { posts, markSeen } = useAnnouncementFeed();
  const [openId, setOpenId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readJson(sessionStorage, dismissedKey(uid), []));
  const [failed, setFailed] = useState<Record<string, number>>(() => readJson(localStorage, failedKey(uid), {}));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const countedThisLaunch = useRef(new Set<string>());
  const post = posts.find(p => p.id === openId);
  const next = posts.filter(p => p.is_announcement && !p.seen_by_me && p.author_id !== user?.id
    && !completed.includes(p.id) && !dismissed.includes(p.id) && (failed[p.id] ?? 0) < MAX_FAILED_LAUNCHES)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  useEffect(() => {
    setOpenId(null); setCompleted([]);
    setDismissed(readJson(sessionStorage, dismissedKey(uid), []));
    setFailed(readJson(localStorage, failedKey(uid), {}));
    countedThisLaunch.current = new Set();
  }, [uid]);
  useEffect(() => {
    if (!enabled) { setOpenId(null); return; }
    if (openId || !next) return;
    return whenInviteAllowed(() => setOpenId(next.id));
  }, [enabled, openId, next?.id]);
  useEffect(() => {
    if (post?.seen_by_me) setOpenId(null);
  }, [post?.seen_by_me]);

  /** Close for this session only; the post stays unread. */
  const dismiss = () => {
    if (!openId) return;
    const id = openId;
    setDismissed(ids => { const nextIds = ids.includes(id) ? ids : [...ids, id]; writeJson(sessionStorage, dismissedKey(uid), nextIds); return nextIds; });
    setOpenId(null);
  };
  const recordFailure = (id: string) => {
    if (countedThisLaunch.current.has(id)) return;
    countedThisLaunch.current.add(id);
    setFailed(prev => { const nextMap = { ...prev, [id]: (prev[id] ?? 0) + 1 }; writeJson(localStorage, failedKey(uid), nextMap); return nextMap; });
  };

  const finish = async () => {
    if (!post || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      let ok = false; let message = 'Your read could not be saved. Check your connection and try again.';
      try { ok = await markSeen(post.id); } catch (e) { if (e instanceof Error && e.message) message = e.message; }
      if (!ok) {
        recordFailure(post.id);
        toast.error('Could not save your response', { description: `${message} You can close this and it will show again next time.` });
        return;
      }
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
  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
    <DialogContent
      className="duo-popup duo-ann flex max-h-[90dvh] max-w-md flex-col gap-0 rounded-lg p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onPointerDownOutside={e => e.preventDefault()}
      onInteractOutside={e => e.preventDefault()}
    >
      <DialogHeader className="shrink-0 px-6 pt-6 pb-3 pr-12">
        <Megaphone className="h-6 w-6 text-primary" />
        <DialogTitle>{post.subject || 'Announcement'}</DialogTitle>
        <DialogDescription>{post.author?.nickname || post.author?.full_name || 'Your team'}</DialogDescription>
      </DialogHeader>
      <div data-testid="announcement-body" className="flex-1 min-h-0 overflow-y-auto space-y-3 px-6 pb-3" onScroll={e => {
        const el = e.currentTarget;
        if (!post.require_confirm && document.visibilityState === 'visible' && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) void finish();
      }}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.body}</p>
        {post.media.map((media, i) => media.type === 'image'
          ? <img key={i} src={media.url} alt={media.name || 'Announcement attachment'} className="w-full rounded-lg" />
          : <a key={i} href={media.url} target="_blank" rel="noopener noreferrer" className="block text-primary underline">{media.name || 'View attachment'}</a>)}
      </div>
      <div className="shrink-0 border-t px-6 py-3">
        <Button className="w-full" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving…' : "I've read this"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
