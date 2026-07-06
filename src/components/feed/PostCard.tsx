import { memo, useState, useEffect, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MessageCircle, Eye, Pin, MoreHorizontal, Paperclip } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { FeedPost } from '@/hooks/useAnnouncementFeed';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InlineComments } from './InlineComments';
import { MediaLightbox } from './MediaLightbox';

interface PostCardProps {
  post: FeedPost;
  currentUserId: string | null;
  canModerate: boolean;
  
  onOpenSeenBy: (post: FeedPost) => void;
  onToggleReaction: (postId: string, emoji: string, mine: boolean) => void;
  onDelete: (postId: string) => void;
  onMarkSeen?: (postId: string) => boolean | Promise<boolean>;
}

const BODY_TRUNCATE_CHARS = 320;

function getInitials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function friendlyFileName(m: { name?: string; url: string }) {
  if (m.name) return decodeURIComponent(m.name);
  try {
    const u = new URL(m.url);
    return decodeURIComponent(u.pathname.split('/').pop() || 'Attachment');
  } catch { return 'Attachment'; }
}

function PostCardImpl({ post, currentUserId, canModerate, onOpenSeenBy, onToggleReaction, onDelete, onMarkSeen }: PostCardProps) {
  const authorName = post.author?.nickname || post.author?.full_name || 'Unknown';
  const isMine = post.author_id === currentUserId;
  const images = post.media.filter(m => m.type === 'image').slice(0, 4);
  const files = post.media.filter(m => m.type !== 'image');

  const [expanded, setExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxItems = post.media;
  const shouldTruncate = post.body.length > BODY_TRUNCATE_CHARS;
  const displayBody = !shouldTruncate || expanded
    ? post.body
    : post.body.slice(0, BODY_TRUNCATE_CHARS).replace(/\s+\S*$/, '') + '…';

  // Mark as seen when scrolled into view for ~800ms (once per post per session).
  // Uses a low threshold so tall posts on small viewports still register.
  const rootRef = useRef<HTMLElement | null>(null);
  const markedRef = useRef(false);
  useEffect(() => {
    if (!onMarkSeen || post.seen_by_me || markedRef.current || isMine) return;
    const el = rootRef.current;
    if (!el) return;
    let timer: number | null = null;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !markedRef.current) {
          if (timer == null) {
            timer = window.setTimeout(async () => {
              const recorded = await onMarkSeen(post.id);
              if (recorded) {
                markedRef.current = true;
                io.disconnect();
              }
              timer = null;
            }, 800);
          }
        } else if (timer != null) {
          window.clearTimeout(timer);
          timer = null;
        }
      }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      io.disconnect();
    };
  }, [post.id, post.seen_by_me, isMine, onMarkSeen]);

  return (
    <article
      ref={rootRef}
      className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm transition-colors hover:bg-muted/50"
    >
      {/* Header */}
      <header className="flex items-start gap-3 px-4 pt-4 pb-2">
        <Avatar className="h-11 w-11 shrink-0">
          <AvatarImage src={post.author?.profile_photo_url ?? undefined} alt={authorName} />
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {getInitials(authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{authorName}</span>
            {post.is_announcement && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                Announcement
              </span>
            )}
            {post.badge && (
              <span
                className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${post.badge.color ?? '#3B82F6'}22`, color: post.badge.color ?? '#3B82F6' }}
              >
                {post.badge.label}
              </span>
            )}
            {post.channel && (
              <span
                className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${post.channel.color ?? '#3B82F6'}22`, color: post.channel.color ?? '#3B82F6' }}
              >
                {post.channel.name}
              </span>
            )}
            {post.pinned && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600">
                <Pin className="h-3 w-3" /> Pinned
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
            {post.edited_at && <span className="ml-1">· edited</span>}
          </div>
        </div>
        {(isMine || canModerate) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 -mr-1 -mt-1" onClick={e => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  setTimeout(() => {
                    if (window.confirm('Delete this post?')) onDelete(post.id);
                  }, 50);
                }}
              >
                Delete post
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* Media grid — ABOVE text, rounded and inset */}
      {images.length > 0 && (
        <div className="px-3 mt-1">
          <div
            className={cn(
              'grid gap-0.5 w-full bg-muted rounded-xl overflow-hidden',
              images.length === 1 && 'grid-cols-1',
              images.length === 2 && 'grid-cols-2',
              images.length === 3 && 'grid-cols-2',
              images.length === 4 && 'grid-cols-2',
            )}
          >
            {images.map((m, i) => {
              const idx = lightboxItems.indexOf(m);
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => setLightboxIndex(idx >= 0 ? idx : 0)}
                  className={cn(
                    'relative overflow-hidden bg-muted focus:outline-none focus:ring-2 focus:ring-primary',
                    images.length === 3 && i === 0 && 'row-span-2',
                    images.length === 1 ? 'aspect-video' : 'aspect-square',
                  )}
                >
                  <img src={m.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
              );
            })}
          </div>
        </div>
      )}


      {/* Body */}
      {post.body && (
        <div className="px-4 pt-3 pb-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
          {displayBody}
          {shouldTruncate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (expanded) setExpanded(false); else setExpanded(true);
              }}
              className="ml-1 text-primary text-sm font-medium hover:underline"
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {/* File attachments */}
      {files.length > 0 && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {files.map((m, i) => {
            const idx = lightboxItems.indexOf(m);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setLightboxIndex(idx >= 0 ? idx : 0)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 hover:bg-muted px-3 py-2 text-sm min-w-0 text-left w-full"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{friendlyFileName(m)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Meta bar */}
      <div className="px-4 py-2 flex items-center justify-between text-xs text-muted-foreground border-t border-border/50">
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById(`comment-input-${post.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              (el as HTMLInputElement).focus({ preventScroll: true });
            }
          }}
          className="inline-flex items-center gap-1.5 hover:text-foreground"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
        </button>
        <button
          type="button"
          onClick={() => onOpenSeenBy(post)}
          className="inline-flex items-center gap-1.5 hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" />
          {post.seen_count} seen
        </button>
      </div>

      {/* Inline comments */}
      <InlineComments
        postId={post.id}
        allowComments={post.allow_comments}
        currentUserId={currentUserId}
        canModerate={canModerate || post.author_id === currentUserId}
        initialCount={post.comment_count}
      />
    </article>
  );
}

export const PostCard = memo(PostCardImpl);
