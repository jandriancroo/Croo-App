import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MessageCircle, Eye, Pin, Paperclip, ThumbsUp, ThumbsDown, MoreHorizontal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { FeedPost } from '@/hooks/useAnnouncementFeed';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { InlineComments } from './InlineComments';
import { MediaLightbox } from './MediaLightbox';
import { PostActionsPopover } from './PostActionsPopover';


interface PostCardProps {
  post: FeedPost;
  currentUserId: string | null;
  canModerate: boolean;
  
  onOpenSeenBy: (post: FeedPost) => void;
  onToggleReaction: (postId: string, emoji: string, mine: boolean) => void;
  onDelete: (postId: string) => void;
  onEdit?: (postId: string, body: string) => void | Promise<void>;
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

function PostCardImpl({ post, currentUserId, canModerate, onOpenSeenBy, onToggleReaction, onDelete, onEdit, onMarkSeen }: PostCardProps) {
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

  // Long-press to open actions popover (mobile-friendly, works on desktop too)
  const canManage = isMine || canModerate;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const startLongPress = useCallback(() => {
    if (!canManage) return;
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setActionsOpen(true);
    }, 500);
  }, [canManage, clearLongPress]);

  const cancelLongPress = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handleHeaderContextMenu = (e: React.MouseEvent) => {
    if (!canManage) return;
    e.preventDefault();
    setActionsOpen(true);
  };

  return (
    <article
      ref={rootRef}
      className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm transition-colors hover:bg-muted/50"
    >
      {/* Header */}
      <header className="relative px-3 pt-3">
        <div
          ref={headerRef}
          className={cn(
            "flex items-start gap-3 rounded-xl bg-primary/10 px-3 py-3 select-none",
            canManage && "cursor-pointer",
          )}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onContextMenu={handleHeaderContextMenu}
        >
          <Avatar className="h-11 w-11 shrink-0">
            <AvatarImage src={post.author?.profile_photo_url ?? undefined} alt={authorName} />
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {getInitials(authorName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {/* Top row: name + timestamp */}
            <div className="flex items-center gap-2 pr-1">
              <span className="font-semibold text-sm truncate">{authorName}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                {post.edited_at && <span className="ml-1">· edited</span>}
              </span>
            </div>
            {/* Second row: badges */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
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
                <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" aria-label="Pinned">
                  <Pin className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              aria-label="Post options"
              className="shrink-0 -mr-1 -mt-1 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-background/70 hover:text-foreground transition-colors"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setActionsOpen((o) => !o);
              }}
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>


      {/* Actions popover (long-press) */}
      {canManage && (
        <PostActionsPopover
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          triggerRef={headerRef}
          canEdit={isMine && !!onEdit}
          onEdit={() => {
            setEditBody(post.body);
            setEditOpen(true);
          }}
          onDelete={() => setConfirmDeleteOpen(true)}
        />
      )}

      {/* Edit dialog */}
      {canManage && onEdit && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit post</DialogTitle>
            </DialogHeader>
            <Textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={6}
              className="resize-none"
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                onClick={async () => {
                  const trimmed = editBody.trim();
                  if (!trimmed || trimmed === post.body) { setEditOpen(false); return; }
                  await onEdit(post.id, trimmed);
                  setEditOpen(false);
                }}
              >
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Confirm delete */}
      {canManage && (
        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this post?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the post along with its comments and reactions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onDelete(post.id)}
              >
                Delete post
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}


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

      {/* Reactions bar */}
      {(() => {
        const like = post.reactions.find(r => r.emoji === '👍');
        const dislike = post.reactions.find(r => r.emoji === '👎');
        return (
          <div className="px-4 pt-2 flex items-center gap-2 border-t border-border/50">
            <button
              type="button"
              onClick={() => onToggleReaction(post.id, '👍', !!like?.mine)}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-medium transition-colors',
                like?.mine ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
              aria-pressed={!!like?.mine}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {like?.count ?? 0}
            </button>
            <button
              type="button"
              onClick={() => onToggleReaction(post.id, '👎', !!dislike?.mine)}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-medium transition-colors',
                dislike?.mine ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground hover:bg-muted',
              )}
              aria-pressed={!!dislike?.mine}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              {dislike?.count ?? 0}
            </button>
          </div>
        );
      })()}

      {/* Meta bar */}
      <div className="px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
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

      <MediaLightbox
        items={lightboxItems}
        index={lightboxIndex}
        onOpenChange={(o) => { if (!o) setLightboxIndex(null); }}
        onIndexChange={setLightboxIndex}
      />
    </article>
  );
}

export const PostCard = memo(PostCardImpl);
