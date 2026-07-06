import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { toast } from 'sonner';

export interface FeedAuthor {
  id: string;
  full_name: string | null;
  nickname: string | null;
  profile_photo_url: string | null;
}

export interface FeedMedia {
  url: string;
  type: 'image' | 'file';
  name?: string;
  mime?: string;
  width?: number;
  height?: number;
}

// --- Private storage URL signing ---
// Legacy attachments point at private buckets via /object/public/ URLs which 404.
// Re-sign them so <img>/<a> tags can load them.
const PRIVATE_BUCKETS = new Set(['message-attachments', 'announcement-media']);
const signedCache = new Map<string, { url: string; exp: number }>();

function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(\?.*)?$/);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

async function signMediaUrls(media: FeedMedia[]): Promise<FeedMedia[]> {
  if (!media?.length) return media;
  const now = Date.now();
  const byBucket = new Map<string, { idx: number; path: string }[]>();
  const out = media.map(m => ({ ...m }));

  out.forEach((m, idx) => {
    const parsed = parseStorageUrl(m.url);
    if (!parsed || !PRIVATE_BUCKETS.has(parsed.bucket)) return;
    const cacheKey = `${parsed.bucket}/${parsed.path}`;
    const hit = signedCache.get(cacheKey);
    if (hit && hit.exp > now) { out[idx].url = hit.url; return; }
    if (!byBucket.has(parsed.bucket)) byBucket.set(parsed.bucket, []);
    byBucket.get(parsed.bucket)!.push({ idx, path: parsed.path });
  });

  const expiresIn = 60 * 60; // 1h
  await Promise.all(Array.from(byBucket.entries()).map(async ([bucket, entries]) => {
    const paths = entries.map(e => e.path);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresIn);
    if (error || !data) return;
    data.forEach((row: any, i) => {
      if (!row?.signedUrl) return;
      out[entries[i].idx].url = row.signedUrl;
      signedCache.set(`${bucket}/${entries[i].path}`, { url: row.signedUrl, exp: now + (expiresIn - 60) * 1000 });
    });
  }));

  return out;
}

export interface FeedBadge {
  id: string;
  label: string;
  tier: 'team' | 'manager';
  color: string | null;
  is_active: boolean;
  sort_order: number;
  location_id: string | null;
  brand_id: string | null;
  created_by: string | null;
}

export interface FeedPost {
  id: string;
  author_id: string;
  brand_id: string | null;
  location_id: string | null;
  channel_id: string | null;
  badge_id: string | null;
  is_announcement: boolean;
  body: string;
  media: FeedMedia[];
  pinned: boolean;
  allow_comments: boolean;
  created_at: string;
  edited_at: string | null;
  author: FeedAuthor | null;
  channel: { id: string; name: string; color: string | null } | null;
  badge: FeedBadge | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  comment_count: number;
  seen_count: number;
  seen_by_me: boolean;
}

export interface FeedChannel {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  audience_type: 'everyone' | 'managers' | string;
}

const POSTS_KEY = (locationId: string | null) => ['announcement-feed', locationId];
const CHANNELS_KEY = (locationId: string | null) => ['announcement-channels', locationId];
const BADGES_KEY = (locationId: string | null) => ['feed-badges', locationId];

export function useAnnouncementFeed(
  activeChannelId: string | 'all' = 'all',
  activeBadgeId: string | 'all' = 'all',
) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const locationId = currentLocation?.id ?? null;

  // --- Channels ---
  const channelsQuery = useQuery({
    queryKey: CHANNELS_KEY(locationId),
    enabled: !!locationId,
    queryFn: async (): Promise<FeedChannel[]> => {
      const { data, error } = await supabase
        .from('announcement_channels')
        .select('id, name, slug, color, icon, sort_order, audience_type')
        .or(`location_id.eq.${locationId},and(location_id.is.null,brand_id.not.is.null)`)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as FeedChannel[];
    },
  });

  // --- Badges (global + location + brand-scoped, active only) ---
  const badgesQuery = useQuery({
    queryKey: BADGES_KEY(locationId),
    enabled: !!user,
    queryFn: async (): Promise<FeedBadge[]> => {
      let q = supabase
        .from('feed_badges')
        .select('id, label, tier, color, is_active, sort_order, location_id, brand_id, created_by')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('label', { ascending: true });
      if (locationId) {
        q = q.or(`location_id.eq.${locationId},and(location_id.is.null,brand_id.is.null)`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as FeedBadge[];
    },
  });

  // --- Posts ---
  const postsQuery = useQuery({
    queryKey: [...POSTS_KEY(locationId), activeChannelId, activeBadgeId],
    enabled: !!locationId && !!user,
    queryFn: async (): Promise<FeedPost[]> => {
      let q = supabase
        .from('announcement_posts')
        .select('id, author_id, brand_id, location_id, channel_id, badge_id, is_announcement, body, media, pinned, allow_comments, created_at, edited_at')
        .is('deleted_at', null)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (locationId) q = q.eq('location_id', locationId);
      if (activeChannelId !== 'all') q = q.eq('channel_id', activeChannelId);
      if (activeBadgeId !== 'all') q = q.eq('badge_id', activeBadgeId);
      const { data: posts, error } = await q;
      if (error) throw error;
      if (!posts?.length) return [];

      const postIds = posts.map(p => p.id);
      const authorIds = Array.from(new Set(posts.map(p => p.author_id)));
      const channelIds = Array.from(new Set(posts.map(p => p.channel_id).filter(Boolean))) as string[];
      const badgeIds = Array.from(new Set(posts.map((p: any) => p.badge_id).filter(Boolean))) as string[];

      const [authorsRes, channelsRes, badgesRes, reactionsRes, commentsRes, readsRes] =
        await Promise.all([
          supabase.from('profiles').select('id, full_name, nickname, profile_photo_url').in('id', authorIds),
          channelIds.length
            ? supabase.from('announcement_channels').select('id, name, color').in('id', channelIds)
            : Promise.resolve({ data: [] as any[] }),
          badgeIds.length
            ? supabase.from('feed_badges').select('id, label, tier, color, is_active, sort_order, location_id, brand_id, created_by').in('id', badgeIds)
            : Promise.resolve({ data: [] as any[] }),
          supabase.from('announcement_reactions').select('post_id, user_id, emoji').in('post_id', postIds),
          supabase.from('announcement_comments').select('post_id').in('post_id', postIds).is('deleted_at', null),
          supabase.from('announcement_reads').select('post_id, user_id').in('post_id', postIds),
        ]);

      const loadError = authorsRes.error ?? channelsRes.error ?? badgesRes.error ?? reactionsRes.error ?? commentsRes.error ?? readsRes.error;
      if (loadError) throw loadError;

      const authors = authorsRes.data ?? [];
      const channels = channelsRes.data ?? [];
      const badges = badgesRes.data ?? [];
      const reactions = reactionsRes.data ?? [];
      const comments = commentsRes.data ?? [];
      const reads = readsRes.data ?? [];

      const authorMap = new Map((authors ?? []).map((a: any) => [a.id, a]));
      const channelMap = new Map((channels ?? []).map((c: any) => [c.id, c]));
      const badgeMap = new Map((badges ?? []).map((b: any) => [b.id, b]));

      const built = posts.map((p: any) => {
        const rxs = (reactions ?? []).filter((r: any) => r.post_id === p.id);
        const grouped: Record<string, { count: number; mine: boolean }> = {};
        for (const r of rxs) {
          if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, mine: false };
          grouped[r.emoji].count += 1;
          if (r.user_id === user!.id) grouped[r.emoji].mine = true;
        }
        const postReads = (reads ?? []).filter((r: any) => r.post_id === p.id);
        return {
          ...p,
          media: (Array.isArray(p.media) ? p.media : []) as unknown as FeedMedia[],
          author: authorMap.get(p.author_id) ?? null,
          channel: p.channel_id ? channelMap.get(p.channel_id) ?? null : null,
          badge: p.badge_id ? badgeMap.get(p.badge_id) ?? null : null,
          reactions: Object.entries(grouped).map(([emoji, v]) => ({ emoji, ...v })),
          comment_count: (comments ?? []).filter((c: any) => c.post_id === p.id).length,
          seen_count: postReads.length,
          seen_by_me: postReads.some((r: any) => r.user_id === user!.id),
        } as FeedPost;
      });

      await Promise.all(built.map(async (post) => {
        post.media = await signMediaUrls(post.media);
      }));

      return built;
    },
  });

  useEffect(() => {
    if (!locationId) return;
    const channel = supabase
      .channel(`ann-feed-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_posts', filter: `location_id=eq.${locationId}` }, () => {
        queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reactions' }, () => {
        queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_comments' }, () => {
        queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reads' }, () => {
        queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_badges' }, () => {
        queryClient.invalidateQueries({ queryKey: BADGES_KEY(locationId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [locationId, queryClient]);

  const markSeen = useCallback(async (postId: string): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase
      .from('announcement_reads')
      .insert({ post_id: postId, user_id: user.id });
    if (error) {
      if (error.code === '23505') {
        queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
        return true;
      }
      console.error('[markSeen] failed to record post read', { postId, error });
      return false;
    }
    queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
    return true;
  }, [user, queryClient, locationId]);

  const toggleReaction = useMutation({
    mutationFn: async ({ postId, emoji, mine }: { postId: string; emoji: string; mine: boolean }) => {
      if (!user) throw new Error('Not signed in');
      if (mine) {
        const { error } = await supabase
          .from('announcement_reactions')
          .delete()
          .eq('post_id', postId).eq('user_id', user.id).eq('emoji', emoji);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('announcement_reactions')
          .insert({ post_id: postId, user_id: user.id, emoji });
        if (error) throw error;
      }
    },
    onError: (e: any) => toast.error(e.message ?? 'Reaction failed'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) }),
  });

  const createPost = useMutation({
    mutationFn: async ({
      body, media, channelId, pinned, badgeId, isAnnouncement,
    }: {
      body: string; media: FeedMedia[]; channelId: string | null; pinned?: boolean;
      badgeId?: string | null; isAnnouncement?: boolean;
    }) => {
      if (!user || !locationId) throw new Error('Missing context');
      const { data: locRow } = await supabase.from('locations').select('brand_id, name').eq('id', locationId).single();
      const { data, error } = await supabase.from('announcement_posts').insert({
        author_id: user.id,
        location_id: locationId,
        brand_id: (locRow as any)?.brand_id ?? null,
        channel_id: channelId,
        badge_id: badgeId ?? null,
        is_announcement: !!isAnnouncement,
        body,
        media: media as any,
        pinned: !!pinned,
      }).select().single();
      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      toast.success('Posted');
      queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
    },
    onError: (e: any) => toast.error(e.message ?? 'Post failed'),
  });

  const createBadge = useMutation({
    mutationFn: async ({ label, color }: { label: string; color?: string | null }) => {
      if (!user || !locationId) throw new Error('Missing context');
      const { data, error } = await supabase.from('feed_badges').insert({
        label: label.trim(),
        tier: 'manager',
        color: color ?? '#3B82F6',
        location_id: locationId,
        created_by: user.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Badge created');
      queryClient.invalidateQueries({ queryKey: BADGES_KEY(locationId) });
    },
    onError: (e: any) => toast.error(e.message ?? 'Could not create badge'),
  });

  const deletePost = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.rpc('soft_delete_announcement_post', { _post_id: postId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Post deleted');
      queryClient.invalidateQueries({ queryKey: POSTS_KEY(locationId) });
    },
    onError: (e: any) => toast.error(e.message ?? 'Delete failed'),
  });

  return {
    posts: postsQuery.data ?? [],
    channels: channelsQuery.data ?? [],
    badges: badgesQuery.data ?? [],
    isLoading: postsQuery.isLoading,
    refetch: postsQuery.refetch,
    markSeen,
    toggleReaction: (postId: string, emoji: string, mine: boolean) => toggleReaction.mutate({ postId, emoji, mine }),
    createPost: createPost.mutateAsync,
    createBadge: createBadge.mutateAsync,
    deletePost: deletePost.mutateAsync,
  };
}

// --- Comments hook (per-post) ---

export interface FeedComment {
  id: string;
  post_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: FeedAuthor | null;
}

export function useAnnouncementComments(postId: string | null, opts?: { subscribe?: boolean; enabled?: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const subscribe = opts?.subscribe ?? true;
  const enabled = (opts?.enabled ?? true) && !!postId;

  const query = useQuery({
    queryKey: ['announcement-comments', postId],
    enabled,
    queryFn: async (): Promise<FeedComment[]> => {
      const { data, error } = await supabase
        .from('announcement_comments')
        .select('id, post_id, author_id, parent_comment_id, body, created_at, edited_at')
        .eq('post_id', postId!)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      if (!data?.length) return [];
      const ids = Array.from(new Set(data.map(d => d.author_id)));
      const { data: authors } = await supabase.from('profiles').select('id, full_name, nickname, profile_photo_url').in('id', ids);
      const map = new Map((authors ?? []).map((a: any) => [a.id, a]));
      return data.map(d => ({ ...d, author: map.get(d.author_id) ?? null })) as FeedComment[];
    },
  });

  useEffect(() => {
    if (!postId || !subscribe) return;
    const channel = supabase
      .channel(`ann-cmt-${postId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_comments', filter: `post_id=eq.${postId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['announcement-comments', postId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [postId, queryClient, subscribe]);

  const addComment = useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId?: string | null }) => {
      if (!user || !postId) throw new Error('Missing');
      const { error } = await supabase.from('announcement_comments').insert({
        post_id: postId, author_id: user.id, body, parent_comment_id: parentId ?? null,
      });
      if (error) throw error;
    },
    onError: (e: any) => toast.error(e.message ?? 'Comment failed'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcement-comments', postId] }),
  });

  const deleteComment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('announcement_comments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcement-comments', postId] }),
  });

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    addComment: (body: string, parentId?: string | null) => addComment.mutateAsync({ body, parentId }),
    deleteComment: deleteComment.mutateAsync,
  };
}
