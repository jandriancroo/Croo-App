import { useEffect, useMemo, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Megaphone, Loader2, Pin, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useAnnouncementFeed, type FeedPost } from '@/hooks/useAnnouncementFeed';
import { useOpenShiftOffers } from '@/hooks/useOpenShiftOffers';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';

import { SeenByDialog } from './SeenByDialog';
import { ShiftOfferMessage } from '@/components/messages/ShiftOfferMessage';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface AnnouncementFeedProps {
  activeBadge?: string | 'all';
  composerOpen?: boolean;
  onComposerOpenChange?: (open: boolean) => void;
}

function useCurrentProfile(userId: string | null) {
  return useQuery({
    queryKey: ['profile-mini', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, nickname, profile_photo_url')
        .eq('id', userId!)
        .maybeSingle();
      return data;
    },
  });
}

export function AnnouncementFeed({ activeBadge = 'all', composerOpen: composerOpenProp, onComposerOpenChange }: AnnouncementFeedProps = {}) {
  const { user } = useAuth();
  const { isAdmin, isManager, isSuperAdmin, isShiftManager } = useUserRole();
  const canAnnounce = isAdmin || isManager || isSuperAdmin;
  const canCreateBadges = isAdmin || isManager || isSuperAdmin;
  const canModerate = isAdmin || isSuperAdmin;

  const [internalComposerOpen, setInternalComposerOpen] = useState(false);
  const composerOpen = composerOpenProp ?? internalComposerOpen;
  const setComposerOpen = (o: boolean) => {
    if (onComposerOpenChange) onComposerOpenChange(o);
    else setInternalComposerOpen(o);
  };
  const [seenByPost, setSeenByPost] = useState<FeedPost | null>(null);

  const {
    posts, badges, channels, isLoading, toggleReaction, createPost, createBadge, deletePost, updatePost, markSeen,
  } = useAnnouncementFeed('all', activeBadge);
  const composerChannels = useMemo(
    () => channels.filter(c => c.audience_type === 'everyone' || isShiftManager),
    [channels, isShiftManager],
  );
  const { offers: openShiftOffers } = useOpenShiftOffers();
  const { data: me } = useCurrentProfile(user?.id ?? null);

  const pinnedPosts = useMemo(() => posts.filter(p => p.pinned), [posts]);
  const regularPosts = useMemo(() => posts.filter(p => !p.pinned), [posts]);
  const hasPinnedStrip = pinnedPosts.length > 0 || openShiftOffers.length > 0;


  useEffect(() => {
    // Everyone can post; keep this as a no-op guard in case parent triggers composer when unauthed.
    if (composerOpen && !user) setComposerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, user]);

  const displayName = me?.nickname || me?.full_name || 'You';
  const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Feed list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-0 pt-2 pb-3 space-y-3 md:pt-3 md:space-y-3">
          {/* Inline composer trigger */}
          {user && (
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="w-full flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-sm hover:bg-muted/60 transition-colors text-left"
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={me?.profile_photo_url ?? undefined} alt={displayName} />
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <span className="flex-1 text-muted-foreground text-[15px]">Share something with the team…</span>
              <span className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground shrink-0">
                <Plus className="h-4 w-4" />
              </span>
            </button>
          )}

          {/* Badge filter dropdown */}
          {badges.length > 0 && (
            <div className="px-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-sm font-medium whitespace-nowrap transition-colors border"
                    style={
                      activeBadge === 'all'
                        ? { backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderColor: 'hsl(var(--primary))' }
                        : (() => {
                            const b = badges.find(x => x.id === activeBadge);
                            const color = b?.color ?? '#3B82F6';
                            return { backgroundColor: color, color: 'white', borderColor: color };
                          })()
                    }
                  >
                    {activeBadge === 'all' ? 'All' : badges.find(b => b.id === activeBadge)?.label ?? 'All'}
                    <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[160px]">
                  <DropdownMenuRadioGroup value={activeBadge} onValueChange={(v) => setActiveBadge(v as string | 'all')}>
                    <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                    {badges.map(b => (
                      <DropdownMenuRadioItem key={b.id} value={b.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: b.color ?? '#3B82F6' }}
                          />
                          {b.label}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

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
                Share the first update with your team.
              </p>
              <Button onClick={() => setComposerOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> New post
              </Button>
            </div>
          ) : (
            <>
              {hasPinnedStrip && (
                <div className="space-y-3">
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
                      onOpenSeenBy={setSeenByPost}
                      onToggleReaction={toggleReaction}
                      onDelete={(id) => deletePost(id)}
                      onEdit={(id, body) => updatePost({ postId: id, body })}

                      onMarkSeen={markSeen}
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
                  onOpenSeenBy={setSeenByPost}
                  onToggleReaction={toggleReaction}
                  onDelete={(id) => deletePost(id)}
                  onEdit={(id, body) => updatePost({ postId: id, body })}

                  onMarkSeen={markSeen}
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
        channels={composerChannels}
        badges={badges}
        canAnnounce={canAnnounce}
        canCreateBadges={canCreateBadges}
        onSubmit={createPost}
        onCreateBadge={createBadge}
      />


      <SeenByDialog
        post={seenByPost}
        canRemind={canAnnounce}
        onOpenChange={(o) => { if (!o) setSeenByPost(null); }}
      />
    </div>
  );
}
