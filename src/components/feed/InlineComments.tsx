import { useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Trash2, ThumbsUp, ThumbsDown, Reply } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAnnouncementComments, type FeedComment } from '@/hooks/useAnnouncementFeed';
import { cn } from '@/lib/utils';

interface Props {
  postId: string;
  allowComments: boolean;
  currentUserId: string | null;
  canModerate: boolean;
  initialCount: number;
}

function initials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

const PREVIEW_ROOTS = 3;

interface ThreadNode {
  comment: FeedComment;
  children: ThreadNode[];
}

function buildThread(comments: FeedComment[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>();
  const roots: ThreadNode[] = [];
  for (const c of comments) byId.set(c.id, { comment: c, children: [] });
  for (const c of comments) {
    const node = byId.get(c.id)!;
    if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
      byId.get(c.parent_comment_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function InlineComments({ postId, allowComments, currentUserId, canModerate, initialCount }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const { comments, isLoading, addComment, deleteComment, toggleCommentReaction } = useAnnouncementComments(postId, {
    subscribe: false,
    enabled: initialCount > 0,
  });

  const threads = useMemo(() => buildThread(comments), [comments]);
  const visibleRoots = showAll ? threads : threads.slice(-PREVIEW_ROOTS);
  const hiddenRoots = Math.max(0, threads.length - visibleRoots.length);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addComment(body);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const handleSendReply = async (parentId: string) => {
    const body = replyDraft.trim();
    if (!body || sendingReply) return;
    setSendingReply(true);
    try {
      await addComment(body, parentId);
      setReplyDraft('');
      setReplyingTo(null);
    } finally {
      setSendingReply(false);
    }
  };

  const renderNode = (node: ThreadNode, depth: number) => {
    const c = node.comment;
    const name = c.author?.nickname || c.author?.full_name || 'Unknown';
    const isMine = c.author_id === currentUserId;
    const like = c.reactions.find(r => r.emoji === '👍');
    const dislike = c.reactions.find(r => r.emoji === '👎');
    const isReplying = replyingTo === c.id;

    return (
      <div key={c.id} className={cn(depth > 0 && 'ml-8 pl-3 border-l border-border/60')}>
        <div className="flex items-start gap-2 group">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarImage src={c.author?.profile_photo_url ?? undefined} />
            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="bg-muted rounded-2xl px-3 py-1.5 inline-block max-w-full">
              <div className="text-[11px] font-semibold mb-0.5">{name}</div>
              <div className="text-sm whitespace-pre-wrap break-words">{c.body}</div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 ml-1 flex items-center gap-3 flex-wrap">
              <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
              <button
                type="button"
                onClick={() => toggleCommentReaction(c.id, '👍', !!like?.mine)}
                className={cn(
                  'inline-flex items-center gap-0.5 hover:text-foreground transition-colors',
                  like?.mine && 'text-primary font-medium',
                )}
                aria-label="Like"
                aria-pressed={!!like?.mine}
              >
                <ThumbsUp className="h-3 w-3" />
                {like?.count ? like.count : ''}
              </button>
              <button
                type="button"
                onClick={() => toggleCommentReaction(c.id, '👎', !!dislike?.mine)}
                className={cn(
                  'inline-flex items-center gap-0.5 hover:text-foreground transition-colors',
                  dislike?.mine && 'text-destructive font-medium',
                )}
                aria-label="Dislike"
                aria-pressed={!!dislike?.mine}
              >
                <ThumbsDown className="h-3 w-3" />
                {dislike?.count ? dislike.count : ''}
              </button>
              {allowComments && (
                <button
                  type="button"
                  onClick={() => {
                    setReplyingTo(isReplying ? null : c.id);
                    setReplyDraft('');
                  }}
                  className="inline-flex items-center gap-0.5 hover:text-foreground"
                  aria-label="Reply"
                >
                  <Reply className="h-3 w-3" />
                </button>
              )}
              {(isMine || canModerate) && (
                <button
                  onClick={() => { if (confirm('Delete comment?')) deleteComment(c.id); }}
                  className="text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition inline-flex items-center gap-0.5"
                  aria-label="Delete comment"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>

            {isReplying && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  autoFocus
                  value={replyDraft}
                  onChange={e => setReplyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(c.id); }
                    if (e.key === 'Escape') { setReplyingTo(null); setReplyDraft(''); }
                  }}
                  placeholder={`Reply to ${name}...`}
                  maxLength={1000}
                  className="flex-1 h-8 rounded-full bg-muted px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleSendReply(c.id)}
                  disabled={!replyDraft.trim() || sendingReply}
                  className="h-8 w-8 shrink-0 rounded-full"
                  aria-label="Send reply"
                >
                  {sendingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            )}
          </div>
        </div>

        {node.children.length > 0 && (
          <div className="mt-2 space-y-2.5">
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border-t border-border/50 px-4 py-3 space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {isLoading && initialCount > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading comments…
        </div>
      )}

      {hiddenRoots > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          View {hiddenRoots} earlier {hiddenRoots === 1 ? 'comment' : 'comments'}
        </button>
      )}

      {visibleRoots.map(node => renderNode(node, 0))}

      {allowComments && (
        <div className="flex items-center gap-2 pt-1">
          <input
            id={`comment-input-${postId}`}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Write a comment..."
            maxLength={1000}
            className="flex-1 h-9 rounded-full bg-muted px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className="h-9 w-9 shrink-0 rounded-full"
            aria-label="Send comment"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
