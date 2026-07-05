import { memo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MessageCircle, Eye, Pin, MoreHorizontal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ReactionBar } from './ReactionBar';
import type { FeedPost } from '@/hooks/useAnnouncementFeed';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface PostCardProps {
  post: FeedPost;
  currentUserId: string | null;
  canModerate: boolean;
  onOpen: (post: FeedPost) => void;
  onToggleReaction: (postId: string, emoji: string, mine: boolean) => void;
  onDelete: (postId: string) => void;
}

function getInitials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function PostCardImpl({ post, currentUserId, canModerate, onOpen, onToggleReaction, onDelete }: PostCardProps) {
  const authorName = post.author?.nickname || post.author?.full_name || 'Unknown';
  const isMine = post.author_id === currentUserId;
  const images = post.media.filter(m => m.type === 'image').slice(0, 4);

  return (
    <article
      className="bg-card rounded-xl overflow-hidden transition-colors hover:bg-muted/20"
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
                onClick={(e) => { e.stopPropagation(); if (confirm('Delete this post?')) onDelete(post.id); }}
              >
                Delete post
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {/* Body */}
      {post.body && (
        <button
          type="button"
          onClick={() => onOpen(post)}
          className="w-full text-left px-4 pb-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
        >
          {post.body}
        </button>
      )}

      {/* Media grid */}
      {images.length > 0 && (
        <button
          type="button"
          onClick={() => onOpen(post)}
          className={cn(
            'grid gap-0.5 w-full bg-muted',
            images.length === 1 && 'grid-cols-1',
            images.length === 2 && 'grid-cols-2',
            images.length === 3 && 'grid-cols-2',
            images.length === 4 && 'grid-cols-2',
          )}
        >
          {images.map((m, i) => (
            <div
              key={i}
              className={cn(
                'relative overflow-hidden bg-muted',
                images.length === 3 && i === 0 && 'row-span-2',
                images.length === 1 ? 'aspect-video' : 'aspect-square',
              )}
            >
              <img src={m.url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </div>
          ))}
        </button>
      )}

      {/* Meta bar */}
      <div className="px-4 py-2 flex items-center justify-between text-xs text-muted-foreground border-t border-border/50">
        <button type="button" onClick={() => onOpen(post)} className="inline-flex items-center gap-1.5 hover:text-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
        </button>
        <div className="inline-flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" />
          {post.seen_count} seen
        </div>
      </div>

      {/* Reactions */}
      <div className="px-3 pb-3 pt-1">
        <ReactionBar
          reactions={post.reactions}
          onToggle={(emoji, mine) => onToggleReaction(post.id, emoji, mine)}
        />
      </div>
    </article>
  );
}

export const PostCard = memo(PostCardImpl);
