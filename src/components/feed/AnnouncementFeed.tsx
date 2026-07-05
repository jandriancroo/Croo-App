import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Megaphone, Loader2, Pin } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useAnnouncementFeed, type FeedPost } from '@/hooks/useAnnouncementFeed';
import { useOpenShiftOffers } from '@/hooks/useOpenShiftOffers';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import { PostDetailSheet } from './PostDetailSheet';
import { SeenByDialog } from './SeenByDialog';
import { ShiftOfferMessage } from '@/components/messages/ShiftOfferMessage';

interface AnnouncementFeedProps {
  composerOpen?: boolean;
  onComposerOpenChange?: (open: boolean) => void;
}

export function AnnouncementFeed({ composerOpen: composerOpenProp, onComposerOpenChange }: AnnouncementFeedProps = {}) {
  const { user } = useAuth();
  const { isAdmin, isManager, isSuperAdmin } = useUserRole();
  const canPost = isAdmin || isManager || isSuperAdmin;
  const canModerate = isAdmin || isSuperAdmin;

  const [activeChannel, setActiveChannel] = useState<string | 'all'>('all');
  const [internalComposerOpen, setInternalComposerOpen] = useState(false);
  const composerOpen = composerOpenProp ?? internalComposerOpen;
  const setComposerOpen = (o: boolean) => {
    if (onComposerOpenChange) onComposerOpenChange(o);
    else setInternalComposerOpen(o);
  };
  const [openPost, setOpenPost] = useState<FeedPost | null>(null);
  const [seenByPost, setSeenByPost] = useState<FeedPost | null>(null);

  const { posts, channels, isLoading, toggleReaction, createPost, deletePost, markSeen } = useAnnouncementFeed(activeChannel);
  const { offers: openShiftOffers } = useOpenShiftOffers();

  const pinnedPosts = useMemo(() => posts.filter(p => p.pinned), [posts]);
  const regularPosts = useMemo(() => posts.filter(p => !p.pinned), [posts]);
  const hasPinnedStrip = pinnedPosts.length > 0 || openShiftOffers.length > 0;

  const openPostFresh = useMemo(() => {
    if (!openPost) return null;
    return posts.find(p => p.id === openPost.id) ?? openPost;
  }, [openPost, posts]);

  // If parent tries to open composer but user can't post, close it
  useEffect(() => {
    if (composerOpen && !canPost) setComposerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, canPost]);

  const channelTabs = [{ id: 'all' as const, name: 'All', color: null as string | null }, ...channels.map(c => ({ id: c.id, name: c.name, color: c.color }))];

  return (
    <div className="flex flex-col h-full min-h-0">
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
        <div className="px-0 py-2 space-y-2.5 md:py-3 md:space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : posts.length === 0 && openShiftOffers.length === 0 ? (
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
            <>
              {hasPinnedStrip && (
                <div className="space-y-2.5 md:space-y-3">
                  <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Pin className="h-3 w-3" /> Pinned
                  </div>
                  {openShiftOffers.map(o => (
                    <div
                      key={`offer-${o.id}`}
                      className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm px-3 py-3"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          Shift Swap
                        </span>
                      </div>
                      <ShiftOfferMessage offerId={o.id} messageId="" />
                    </div>
                  ))}
                  {pinnedPosts.map(p => (
                    <PostCard
                      key={p.id}
                      post={p}
                      currentUserId={user?.id ?? null}
                      canModerate={canModerate}
                      onOpen={setOpenPost}
                      onOpenSeenBy={setSeenByPost}
                      onToggleReaction={toggleReaction}
                      onDelete={(id) => deletePost(id)}
                    />
                  ))}
                  {regularPosts.length > 0 && (
                    <div className="pt-1 border-t border-border/60" />
                  )}
                </div>
              )}
              {regularPosts.map(p => (
                <PostCard
                  key={p.id}
                  post={p}
                  currentUserId={user?.id ?? null}
                  canModerate={canModerate}
                  onOpen={setOpenPost}
                  onOpenSeenBy={setSeenByPost}
                  onToggleReaction={toggleReaction}
                  onDelete={(id) => deletePost(id)}
                />
              ))}
            </>
          )}
          <div className="h-20" />
        </div>
      </div>

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

      <SeenByDialog
        post={seenByPost}
        canRemind={canPost}
        onOpenChange={(o) => { if (!o) setSeenByPost(null); }}
      />
    </div>
  );
}

