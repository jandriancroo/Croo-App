// THE ONE save path for Team Feed posts: the feed composer (useAnnouncementFeed.createPost) and Theo's
// Post announcement tap both call createFeedPost. Insert the post, then push the channel audience.
import { supabase } from '@/integrations/supabase/client';

export interface CreateFeedPostInput {
  user: { id: string; user_metadata?: any };
  locationId: string;
  body: string;
  subject?: string | null;
  media?: any[];
  channelId: string | null;
  pinned?: boolean;
  badgeId?: string | null;
  isAnnouncement?: boolean;
}

/** Returns the inserted post and how many people the push went to. */
export async function createFeedPost(i: CreateFeedPostInput): Promise<{ post: any; notified: number }> {
  const { user, locationId, body, subject, channelId, isAnnouncement } = i;
  const { data: locRow } = await supabase.from('locations').select('brand_id, name').eq('id', locationId).single();
  const { data, error } = await supabase.from('announcement_posts').insert({
    author_id: user.id,
    location_id: locationId,
    brand_id: (locRow as any)?.brand_id ?? null,
    channel_id: channelId,
    badge_id: i.badgeId ?? null,
    is_announcement: !!isAnnouncement,
    subject: isAnnouncement ? subject?.trim() || null : null,
    body,
    media: (i.media ?? []) as any,
    pinned: !!i.pinned,
  }).select().single();
  if (error) throw error;

  // Push the channel audience (fire-and-forget). The DB trigger backup needs vault secrets that may
  // not be set, so the function is invoked directly for reliability.
  let notified = 0;
  try {
    const { data: recipients } = await supabase.rpc('feed_channel_audience_recipients', {
      _location_id: locationId,
      _channel_id: channelId,
    });
    const userIds = ((recipients as any[]) || []).map((r) => r.user_id).filter((id: string) => id && id !== user.id);
    notified = userIds.length;
    if (userIds.length > 0) {
      const senderName = user.user_metadata?.nickname || user.user_metadata?.full_name || 'Team';
      const preview = (subject?.trim() || body || 'Shared a post').slice(0, 140);
      supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: userIds,
          sender_id: user.id,
          location_id: locationId,
          title: senderName,
          body: preview,
          notification_type: isAnnouncement ? 'announcements' : 'chat_messages',
          data: {
            post_id: (data as any)?.id,
            location_id: locationId,
            channel_id: channelId,
            type: isAnnouncement ? 'announcement' : 'feed_post',
          },
        },
      }).catch((e) => console.warn('feed push failed', e));
    }
  } catch (e) {
    console.warn('feed push dispatch skipped', e);
  }
  return { post: data, notified };
}

/** Theo's Undo (10 minutes): delete the post. The push already went out. */
export async function deleteFeedPost(postId: string) {
  const { error } = await supabase.from('announcement_posts').delete().eq('id', postId);
  if (error) throw error;
}
