import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAnnouncementComments } from '@/hooks/useAnnouncementFeed';

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

const PREVIEW = 3;

export function InlineComments({ postId, allowComments, currentUserId, canModerate, initialCount }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Only auto-fetch when there are comments to show; otherwise fetch lazily on first send
  const { comments, isLoading, addComment, deleteComment } = useAnnouncementComments(postId, {
    subscribe: false,
    enabled: initialCount > 0,
  });

  const visible = showAll ? comments : comments.slice(-PREVIEW);
  const hidden = Math.max(0, comments.length - visible.length);

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

  return (
    <div className="border-t border-border/50 px-4 py-3 space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {isLoading && initialCount > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading comments…
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          View {hidden} earlier {hidden === 1 ? 'comment' : 'comments'}
        </button>
      )}

      {visible.map(c => {
        const name = c.author?.nickname || c.author?.full_name || 'Unknown';
        const isMine = c.author_id === currentUserId;
        return (
          <div key={c.id} className="flex items-start gap-2 group">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={c.author?.profile_photo_url ?? undefined} />
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="bg-muted rounded-2xl px-3 py-1.5 inline-block max-w-full">
                <div className="text-[11px] font-semibold mb-0.5">{name}</div>
                <div className="text-sm whitespace-pre-wrap break-words">{c.body}</div>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 ml-1 flex items-center gap-2">
                <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                {(isMine || canModerate) && (
                  <button
                    onClick={() => { if (confirm('Delete comment?')) deleteComment(c.id); }}
                    className="text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                    aria-label="Delete comment"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {allowComments && (
        <div className="flex items-center gap-2 pt-1">
          <input
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
