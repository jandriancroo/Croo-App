## Goal
Replace the current Announce list view with a Facebook/Workplace-style **Feed** — post cards with author, timestamp, body, images, reactions, comments, and read receipts — while keeping existing announcement posting permissions (admins/managers post, everyone can react & comment).

## What changes for the user
- Announce tab becomes a scrollable **Feed** of post cards
- Each post shows: avatar, author name + role, timestamp, channel badge, body text, optional image(s), reaction bar, comment count, seen-by count
- Tap a post → detail view with full comments thread + reaction picker + read-receipts sheet (reuses `AnnouncementStats`)
- Channel tabs at top: **All · Everyone · Managers · FOH · BOH · Location-specific** (managed per-brand)
- Comments allowed for all staff on any announcement they can see
- Composer (admins/managers only): rich text + image upload + audience/channel picker
- Reactions: 6 preset emojis (👍 ❤️ 🔥 🎉 😂 👏) — long-press picker, tap to toggle
- Real-time updates for new posts, reactions, comments (Supabase Realtime)

## Data model (new tables)

```text
announcement_channels
  id, brand_id, location_id (nullable), name, slug, color, icon,
  audience_type ('everyone'|'role'|'position'|'custom'), audience_config jsonb,
  sort_order, is_active
  → RLS: readable by members of brand/location; managed by admins

announcement_posts        -- replaces "is_announcement chat" model going forward
  id, author_id, brand_id, location_id, channel_id,
  body text, media jsonb (array of {url,type,width,height}),
  pinned boolean, allow_comments boolean default true,
  chat_id (nullable, links to legacy announcement chat for migration),
  created_at, updated_at, edited_at

announcement_reactions
  id, post_id, user_id, emoji text
  unique(post_id, user_id, emoji)

announcement_comments
  id, post_id, author_id, parent_comment_id (nullable, 1-level replies),
  body, media jsonb, created_at, edited_at, deleted_at

announcement_comment_reactions
  id, comment_id, user_id, emoji
  unique(comment_id, user_id, emoji)
```

- Read receipts continue to use existing `announcement_reads` — extended with `post_id` column (nullable, backfilled). Legacy `chat_id`-based reads keep working.
- All tables get RLS + GRANTs (authenticated + service_role), realtime enabled on `announcement_posts`, `announcement_reactions`, `announcement_comments`.

## Frontend
New folder `src/components/feed/`:
- `AnnouncementFeed.tsx` — main scroll list, channel tabs, composer FAB
- `PostCard.tsx` — avatar / body / media grid / reaction bar / comment count / seen-by
- `PostDetail.tsx` — full post + comment thread (bottom sheet or `/feed/:postId` route)
- `CommentThread.tsx`, `CommentItem.tsx`, `CommentComposer.tsx`
- `ReactionBar.tsx` + `ReactionPicker.tsx` (long-press)
- `ChannelTabs.tsx`, `ChannelPickerSheet.tsx`
- `PostComposer.tsx` — rich body, image upload to existing Supabase storage bucket, channel + audience selector (admin/manager gated)
- `hooks/useAnnouncementFeed.tsx`, `useAnnouncementComments.tsx`, `useAnnouncementReactions.tsx`

Wire into `src/pages/Messages.tsx` — when `viewMode === 'announcements'`, render `<AnnouncementFeed />` instead of the chat list. Chat / Business / Support tabs untouched.

## Migration path
- Existing announcement chats stay readable (legacy view button on empty feed).
- Backfill script: for each `chats.is_announcement=true`, copy its `messages` rows into `announcement_posts` (1 post per message), link `chat_id`, migrate `announcement_reads` rows to `post_id`. Run once via `insert` tool after schema lands.

## Permissions
- Posting: unchanged — same roles that can create announcement chats today (admin, brand_admin, manager, super_admin) can create posts. Enforced via RLS using `has_role_or_higher`.
- Commenting: any authenticated user who can read the post (member of the channel's audience).
- Reactions: same as comments.
- Deleting: author or admin+.

## Locked-feature check
None of: 3D cubes, inventory, fluid dock, version updater, support tickets. ✅ Clear to proceed.

## Rollout order
1. **Migration** — 5 new tables + columns + RLS + realtime
2. **Backfill** — copy legacy announcement chats → posts (via `insert` tool)
3. **Feed shell** — `AnnouncementFeed` + `PostCard` reading new data
4. **Reactions + comments** UI + hooks
5. **Composer** with image upload + channel picker
6. **Channel management** admin screen (Brand Settings → Announce Channels)
7. **Realtime** wiring + polish (animations, empty states, pull-to-refresh)

## Technical notes
- Business dates via existing Luxon helpers (America/Los_Angeles) — never `new Date(string)`.
- No changes to `sales_cache`, `labor_cache`, or any locked feature.
- Image uploads → existing storage bucket used by messages (or new `announcement-media` bucket if none suitable).
- Comments and reactions use optimistic updates with React Query `setQueryData`.
- Mobile-first, 60fps: virtualize feed once >30 posts (react-virtuoso already in project).

## Out of scope for v1
- Threaded replies beyond 1 level
- @mentions with notifications (can add in v2)
- Post scheduling / drafts
- Video uploads (images only in v1)
- Analytics dashboard beyond existing seen-by

Ship as one PR per step above; each step independently deployable.