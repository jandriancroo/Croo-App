import { useEffect, useRef, useState } from 'react';
import { Lock, MapPin, Maximize2, X } from 'lucide-react';
import { format } from 'date-fns';
import { useLocation } from '@/hooks/useLocation';
import { MediaLightbox } from '@/components/feed/MediaLightbox';
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { currentLocation } = useLocation();
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
  useEffect(() => { setLightboxIndex(null); }, [openId, enabled]);
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
    if (!post || !enabled || post.require_confirm || lightboxIndex !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => void finish(), 5000);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [post?.id, enabled, markSeen, lightboxIndex]);

  if (!post || !enabled) return null;
  const authorName = post.author?.nickname || post.author?.full_name || 'Your team';
  const authorRole = (post.author as { role?: string | null } | null)?.role || null;
  const initials = authorName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';
  let dateLabel = '';
  try { dateLabel = format(new Date(post.created_at), 'MMM d · h:mm a'); } catch { dateLabel = ''; }
  const images = post.media.map((m, i) => ({ m, i })).filter(x => x.m.type === 'image');
  const files = post.media.map((m, i) => ({ m, i })).filter(x => x.m.type !== 'image');
  const locationName = currentLocation?.name;
  return <>
    <Dialog open onOpenChange={open => { if (!open && lightboxIndex === null) dismiss(); }}>
      <DialogContent
        className="duo-popup duo-ann flex max-h-[90dvh] max-w-md flex-col gap-0 overflow-hidden rounded-lg bg-card p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] [&>button.absolute]:hidden"
        onPointerDownOutside={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 space-y-0 bg-primary px-5 pt-4 pb-4 text-left text-primary-foreground">
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Close" onClick={dismiss} className="grid h-11 w-11 place-items-center rounded-full bg-primary-foreground/15 text-primary-foreground">
              <X className="h-4 w-4" />
            </button>
            {dateLabel && <span data-testid="announcement-date" className="rounded-full bg-primary-foreground/15 px-2.5 py-0.5 text-xs font-semibold">{dateLabel}</span>}
          </div>
          <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-primary-foreground/90">Announcement</div>
          <DialogTitle className="mt-1 text-[21px] leading-tight font-extrabold [text-wrap:balance] text-primary-foreground">{post.subject || 'Announcement'}</DialogTitle>
          <DialogDescription className="sr-only">Posted by {authorName}</DialogDescription>
          <div className="mt-4 border-t border-primary-foreground/20" />
          <div className="flex items-center justify-between gap-3 pt-3">
            {locationName
              ? <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-primary-foreground/15 px-2.5 py-0.5 text-xs font-semibold"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{locationName}</span></span>
              : <span />}
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="min-w-0 text-right">
                <div className="truncate text-sm font-bold">{authorName}</div>
                {authorRole && <div className="truncate text-xs text-primary-foreground/85">{authorRole}</div>}
              </div>
              {post.author?.profile_photo_url
                ? <img src={post.author.profile_photo_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-foreground text-xs font-bold text-primary">{initials}</span>}
            </div>
          </div>
        </DialogHeader>
        <div data-testid="announcement-body" className="flex-1 min-h-0 overflow-y-auto space-y-3 bg-card px-5 py-4" onScroll={e => {
          const el = e.currentTarget;
          if (!post.require_confirm && document.visibilityState === 'visible' && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) void finish();
        }}>
          {images.length > 0 && <div className={images.length > 1 ? 'grid grid-cols-2 gap-2' : undefined}>
            {images.map(({ m, i }) => <button key={i} type="button" aria-label="View photo" onClick={() => setLightboxIndex(i)} className="relative block w-full aspect-[16/10] overflow-hidden rounded-lg bg-muted">
              <img src={m.url} alt={m.name || ''} className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white"><Maximize2 className="h-3.5 w-3.5" /></span>
            </button>)}
          </div>}
          {files.map(({ m, i }) => <a key={i} href={m.url} target="_blank" rel="noopener noreferrer" className="block text-primary underline">{m.name || 'View attachment'}</a>)}
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">{post.body}</p>
        </div>
        <div className="shrink-0 border-t bg-card px-4 py-3">
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Please confirm you've read this</div>
          <Button className="mt-2 w-full" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving…' : "I've read this"}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <MediaLightbox items={post.media} index={lightboxIndex} onOpenChange={o => { if (!o) setLightboxIndex(null); }} onIndexChange={setLightboxIndex} />
  </>;
}
