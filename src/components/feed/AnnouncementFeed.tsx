import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Megaphone, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useAnnouncementFeed, type FeedPost } from '@/hooks/useAnnouncementFeed';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import { PostDetailSheet } from './PostDetailSheet';
import { SeenByDialog } from './SeenByDialog';

export function AnnouncementFeed() {
  const { user } = useAuth();
  const { isAdmin, isManager, isSuperAdmin } = useUserRole();
  const canPost = isAdmin || isManager || isSuperAdmin;
  const canModerate = isAdmin || isSuperAdmin;

  const [activeChannel, setActiveChannel] = useState<string | 'all'>('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [openPost, setOpenPost] = useState<FeedPost | null>(null);

  const { posts, channels, isLoading, toggleReaction, createPost, deletePost, markSeen } = useAnnouncementFeed(activeChannel);

  const openPostFresh = useMemo(() => {
    if (!openPost) return null;
    return posts.find(p => p.id === openPost.id) ?? openPost;
  }, [openPost, posts]);

  const channelTabs = [{ id: 'all' as const, name: 'All', color: null as string | null }, ...channels.map(c => ({ id: c.id, name: c.name, color: c.color }))];

  return (
    <div className="flex flex-col h-full min-h-0 bg-card">
      {/* Channel tabs */}
      {channelTabs.length > 1 && (
        <div className="shrink-0 px-3 pt-2 pb-2 border-b border-border overflow-x-auto scrollbar-hide">
          <div className="flex gap-1.5 min-w-max">
            {channelTabs.map(t => {
              const active = activeChannel === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveChannel(t.id as any)}
                  className={`px-3 h-8 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Feed list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-2 space-y-2 md:p-3 md:space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="inline-flex h-14 w-14 rounded-2xl bg-primary/10 items-center justify-center mb-4">
                <Megaphone className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-1">No posts yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {canPost ? 'Share the first update with your team.' : 'Check back soon for team updates.'}
              </p>
              {canPost && (
                <Button onClick={() => setComposerOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> New post
                </Button>
              )}
            </div>
          ) : (
            posts.map(p => (
              <PostCard
                key={p.id}
                post={p}
                currentUserId={user?.id ?? null}
                canModerate={canModerate}
                onOpen={setOpenPost}
                onToggleReaction={toggleReaction}
                onDelete={(id) => deletePost(id)}
              />
            ))
          )}
          <div className="h-20" />
        </div>
      </div>

      {/* Composer FAB */}
      {canPost && (
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="fixed bottom-24 right-4 md:absolute md:bottom-6 md:right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition z-30"
          aria-label="New post"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      <PostComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        channels={channels}
        onSubmit={createPost}
      />

      <PostDetailSheet
        post={openPostFresh}
        currentUserId={user?.id ?? null}
        canModerate={canModerate}
        onOpenChange={(o) => { if (!o) setOpenPost(null); }}
        onToggleReaction={toggleReaction}
        onMarkSeen={markSeen}
      />
    </div>
  );
}
