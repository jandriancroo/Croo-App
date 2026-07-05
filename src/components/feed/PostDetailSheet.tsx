import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Trash2, Loader2, Paperclip } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ReactionBar } from './ReactionBar';
import { useAnnouncementComments, type FeedPost } from '@/hooks/useAnnouncementFeed';
import { cn } from '@/lib/utils';

interface Props {
  post: FeedPost | null;
  currentUserId: string | null;
  canModerate: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleReaction: (postId: string, emoji: string, mine: boolean) => void;
  onMarkSeen: (postId: string) => void;
}

function getInitials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function PostDetailSheet({ post, currentUserId, canModerate, onOpenChange, onToggleReaction, onMarkSeen }: Props) {
  const open = !!post;
  const { comments, addComment, deleteComment, isLoading } = useAnnouncementComments(post?.id ?? null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (post) onMarkSeen(post.id);
  }, [post?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }, [comments.length, open]);

  if (!post) return null;

  const authorName = post.author?.nickname || post.author?.full_name || 'Unknown';
  const images = post.media.filter(m => m.type === 'image');
  const files = post.media.filter(m => m.type !== 'image');
  const friendlyFileName = (m: { name?: string; url: string }) => {
    if (m.name) return decodeURIComponent(m.name);
    try { return decodeURIComponent(new URL(m.url).pathname.split('/').pop() || 'Attachment'); }
    catch { return 'Attachment'; }
  };

  const handleSend = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await addComment(draft.trim());
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <SheetContent side="bottom" className="h-[92vh] rounded-t-2xl p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0">
          <SheetTitle className="text-base">Post</SheetTitle>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {/* Post body */}
          <div className="px-4 pb-4 border-b border-border">
            <div className="flex items-center gap-3 mb-3">
              <Avatar className="h-11 w-11">
                <AvatarImage src={post.author?.profile_photo_url ?? undefined} />
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">{getInitials(authorName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{authorName}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                  {post.channel && <span className="ml-2">· {post.channel.name}</span>}
                </div>
              </div>
            </div>

            {post.body && <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words mb-3">{post.body}</div>}

            {images.length > 0 && (
              <div className={cn('grid gap-1 rounded-lg overflow-hidden', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                {images.map((m, i) => (
                  <img key={i} src={m.url} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                ))}
              </div>
            )}

            <div className="mt-3">
              <ReactionBar reactions={post.reactions} onToggle={(e, mine) => onToggleReaction(post.id, e, mine)} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {post.seen_count} seen · {post.comment_count} comments
            </div>
          </div>

          {/* Comments */}
          <div className="px-4 py-4 space-y-3">
            {isLoading && <div className="text-sm text-muted-foreground">Loading comments...</div>}
            {!isLoading && comments.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6">Be the first to comment</div>
            )}
            {comments.map(c => {
              const name = c.author?.nickname || c.author?.full_name || 'Unknown';
              const isMine = c.author_id === currentUserId;
              return (
                <div key={c.id} className="flex items-start gap-2 group">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={c.author?.profile_photo_url ?? undefined} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">{getInitials(name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="bg-muted rounded-2xl px-3 py-2">
                      <div className="text-xs font-semibold mb-0.5">{name}</div>
                      <div className="text-sm whitespace-pre-wrap break-words">{c.body}</div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 ml-1 flex items-center gap-2">
                      <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                      {(isMine || canModerate) && (
                        <button
                          onClick={() => { if (confirm('Delete comment?')) deleteComment(c.id); }}
                          className="text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Composer */}
        {post.allow_comments ? (
          <div className="border-t border-border p-2 flex items-end gap-2 shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
            <Textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write a comment..."
              className="min-h-[40px] max-h-[120px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              maxLength={1000}
            />
            <Button size="icon" onClick={handleSend} disabled={!draft.trim() || sending} className="shrink-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <div className="border-t border-border p-3 text-xs text-center text-muted-foreground">Comments are turned off</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
