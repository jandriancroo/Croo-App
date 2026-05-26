# Theo Unread Message Notifications

Notify users when Theo has a new message they haven't seen — daily proactive message, Theo-initiated alerts, or responses they navigated away from.

## How "unread" is detected

All three message types land in the existing `theo_chat_messages` table with `role='assistant'`. So:

> **Unread = any `assistant` message where `created_at > user's last_read_at`** (scoped to current `user_id` + `location_id`).

No new message-type column needed.

## Database changes

New table: `theo_read_state`
- `user_id` (uuid) — fk to profiles
- `location_id` (uuid) — fk to locations
- `last_read_at` (timestamptz, default `'epoch'`)
- `last_read_message_id` (uuid, nullable)
- unique on `(user_id, location_id)`
- RLS: user can select/insert/update only their own row

New RPC: `get_theo_unread_count(p_location_id uuid)` → returns `{ count, latest_preview, latest_message_id }`
- Counts assistant messages in today's `chat_date` for the user/location where `created_at > last_read_at`
- Returns the latest unread's first ~70 chars for the bubble preview

New RPC: `mark_theo_read(p_location_id uuid, p_message_id uuid)` → upserts `last_read_at` to that message's `created_at`

## Frontend pieces

### 1. `useTheoUnread()` hook (new)
- Wraps the RPC with React Query
- Subscribes to realtime inserts on `theo_chat_messages` filtered by user/location, invalidates on new assistant rows
- Returns `{ count, preview, latestId, markRead }`

### 2. Red dot + "NEW" on Theo orb
- **Mobile dock** (`TheoOrb` or its container in `CompactDashboard`): small red dot top-right of orb when `count > 0`; gentle one-time pulse on the orb when count increases.
- **Tablet/desktop side tab** (`AiAssistantBubble`): same dot on the pull tab.

### 3. Speech bubble swap (mobile manager dash)
In `CompactDashboard` greeting area:
- `count === 0` → existing "Hey, I'm Theo 👋 / Tap me anytime!" (during 7-day teaching window only, current behavior).
- `count > 0` → always show bubble with **"NEW MESSAGE"** small label + 1-line preview ("Sales pacing 12% behind…"). Bubble stays sticky until read — overrides the 7-day teaching window timeout.

### 4. Mark-as-read on scroll into view
In `AiAssistantBubble` chat sheet:
- IntersectionObserver attached to each assistant message bubble.
- When an unread message becomes visible (≥50% in viewport for ~400ms), call `markRead(messageId)` — server-side guarded to only advance `last_read_at` forward, never backward.
- Auto-scroll to bottom on open still works; if newest message is already in view it gets marked instantly.

## Files touched

- `supabase/migrations/<new>.sql` — new table, RPCs, RLS
- `src/hooks/useTheoUnread.ts` — new
- `src/components/dock/TheoOrb.tsx` — accept `unread` prop, render dot + pulse
- `src/components/dock/CompactDashboard.tsx` — wire hook, swap bubble content, pass unread to orb
- `src/components/ai/AiAssistantBubble.tsx` — dot on side tab; IntersectionObserver on assistant messages calling `markRead`

## Out of scope (for now)

- Push notifications / haptics (you didn't pick that)
- @mentions / cross-user pings (you didn't pick that)
- Per-message read receipts beyond the last_read watermark

