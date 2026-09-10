# Dave Patrick — chat push not arriving after PWA reinstall

## Full inventory: everything that touches chat push / push tokens

**Callers of `send-push-notification` (client):**
- `src/hooks/useChatActions.tsx:37-66` — the DM/chat path; sends `user_ids` from
  `chat_members` minus sender, `notification_type: 'chat_messages'`, no location_id.
- `src/hooks/useAnnouncementFeed.tsx` — announcement posts push to channel audience.
- `src/components/messages/AnnouncementDialog.tsx`, `AnnouncementStats.tsx`,
  `ShiftOfferMessage.tsx`, `feed/SeenByDialog.tsx` — feed/announcement and
  shift-offer pushes.
- `src/components/logbook/LogBookNewEntrySheet.tsx`, `useLogBookData.tsx`,
  `CateringOrderUploadInline.tsx`, `CateringOrdersSection.tsx` — logbook/catering
  notification types.
- `src/components/tasks/CreateTemporaryTaskDialog.tsx`,
  `dashboard/ShareTaskDialog.tsx` — quick-task / shared-task pushes.
- `src/components/schedule/MobileShiftDialog.tsx`, `useScheduleData.tsx` — shift
  request / schedule update pushes.
- `src/components/support/SupportChatPanel.tsx`, `hiring/HiringChatPanel.tsx`,
  `pages/HiringChat.tsx` — support and applicant chat pushes (not
  `chat_messages` type).
- `src/components/DiagnosticMode.tsx` — admin test-push tool.

**Server-side invocations:**
- `supabase/functions/alert-push-sender/index.ts` — alert-engine pushes.
- `supabase/functions/notify-training-approval/index.ts` — training approval push.
- `supabase/functions/shift-reminder-dispatch/index.ts` — scheduled shift reminders.
- `supabase/functions/support-email-service/index.ts`,
  `utility-service/index.ts` — support/utility pushes.

**The function itself:** `supabase/functions/send-push-notification/index.ts` —
the only place `chat_messages` is throttled: in-memory `Map` keyed by `chat_id`
only, one push per chat per 3 minutes globally (`:394-414`, gate at `:432-441`).
No per-recipient throttling exists for DMs.

**Token subscribe/insert logic:**
- `src/hooks/usePushNotifications.tsx:90-170` — permission → `sw-push.js`
  ready → `ensureSubscriptionForKey` → delete stale/same-endpoint rows → cap at 10
  per user → upsert `onConflict: 'user_id,token'` (fallback insert).
- `src/utils/pushVapid.ts:56-89` (`ensureSubscriptionForKey`) — resubscribes when
  the browser subscription's VAPID key doesn't match the server's.
- `src/components/settings/UnifiedNotificationSettings.tsx` — per-location
  `user_notification_settings` toggles + token cleanup references.
- Server prune: `send-push-notification/index.ts:770-782` deletes a token row on
  HTTP 410/404 or VAPID mismatch.

**Service worker:** `public/sw-push.js` — receives the push event, shows the
notification, deep-links on click.

## Short answer for Jordan
It is **not** a multiple-subscription problem, and nothing in his settings is off.
His new install registered fine and every gate is open. The most likely reason he
saw nothing is the **3-minute-per-chat push throttle**: only the first message in a
chat every 3 minutes pushes at all, to anyone. Test messages sent back-to-back in a
chat someone else already pushed into are silently dropped.

## What I verified live (Dave, e856079b…)
- `push_notification_tokens`: 5 web rows, all Apple endpoints. Two are brand new —
  created 01:01:16 and 01:05:41 UTC today, i.e. the reinstall did register. Three
  older ones (Jul 19, Sep 4, Sep 6) are stale leftovers.
- `notification_preferences.chat_messages` = true (updated 01:05 today).
- `user_notification_settings` chat_messages, Palm Springs — `push_enabled` true.
- `user_roles` = org_admin; `role_notification_settings` chat_messages enabled for
  org_admin (and every other role).

So: role gate pass, per-location gate pass, legacy pref gate pass, tokens present.

## The path, with the blockers at each step

### Exact client call path (who calls, and with what)
- Text: `src/hooks/useChatActions.tsx:37-66` (`sendPushNotification`) called from
  `handleSend` at `:138`; GIF at `:193`; file/image at `:272`.
- It selects `chat_members.user_id where chat_id = <id> and user_id != sender`,
  then `supabase.functions.invoke('send-push-notification', { user_ids: […members],
  sender_id, title: sender display name, body: first 100 chars,
  notification_type: 'chat_messages', data: { chat_id, type } })`.

So yes — it **passes explicit `user_ids` built from chat_members** at
`useChatActions.tsx:39-44, 52-61`. There is **no roles param and no location_id** on
this path, so the role lookup branch (`send-push-notification/index.ts:457-495`) and
the per-location settings gate (`:569-594`) are skipped; the only gates are the
chat throttle, the sender filter, the role_notification_settings check (still runs
for explicit user_ids, `:514-551`), and legacy `notification_preferences` (`:595-616`).

Announcements/feed posts do not use this hook; they go through the feed components
(not part of this trace).

### Token upsert: dedupe, not duplicates
`src/hooks/usePushNotifications.tsx:104-170`:
1. `ensureSubscriptionForKey` (`src/utils/pushVapid.ts:56-89`) — if the browser's
   existing subscription was made with a different VAPID key, unsubscribe it and
   resubscribe.
2. Delete rows matching the replaced endpoint (`staleEndpoint`, `:111-118`).
3. Delete any row for this user whose token contains the same endpoint prefix
   (`:121-126`) — kills same-browser duplicates.
4. Cap at 10 tokens per user, deleting oldest (`:131-147`).
5. `upsert` on `onConflict: 'user_id,token'` (`:149-157`); fallback plain insert.

Net: same endpoint never duplicates; **different devices/browsers accumulate** (up
to 10), and a fresh PWA install gets a brand-new Apple endpoint that is a new row.
Old endpoints are only removed lazily — by the server auto-pruning on 410/404
(`send-push-notification/index.ts:770-782`) or the 10-token cap.

Then, in `supabase/functions/send-push-notification/index.ts`:
1. **Chat throttle — `:394-414`, `:432-441`.** `isChatThrottled(chat_id)` allows one
   push **per chat, globally, per 3 minutes** — it is keyed only by `chat_id`, not by
   recipient. Any member's message in the last 3 minutes suppresses the push for
   everyone else. This is the leading suspect for "Dave gets nothing" during testing.
   It is also in-memory per edge instance, so behavior looks random across cold starts.
2. Sender filter `:449`, `:619-626` — fine unless Dave was the sender on the test.
3. Role gate `:514-551` — pass.
4. Preference gates `:563-616` — pass.
5. Tokens `:688-692` — reads **all** rows for the user and sends to each, so multiple
   subscriptions do not block anything; extra rows just cause extra sends, and dead
   ones are auto-pruned on 410/404 or VAPID mismatch (`:770-782`).
6. Delivery — needs the subscription's VAPID key to match the server's. Client
   handles this: `src/utils/pushVapid.ts:56-89` (`ensureSubscriptionForKey`)
   resubscribes when the key differs, and `usePushNotifications.tsx:110-126` deletes
   the replaced/duplicate endpoint rows.

## What a reinstall can still break (ranked)
1. **Throttle collision** (above) — most likely; not reinstall-specific but explains
   a silent test.
2. **Stale Apple endpoints** from before the reinstall (his 3 old rows). They don't
   block the new ones; they just return 410 and get pruned on the next send. Harmless
   noise, worth confirming in the function logs.
3. **iOS permission state**: on iOS, a reinstalled home-screen app starts fresh; if
   the prompt was ever dismissed/denied, `Notification.permission === 'denied'` and
   the hook bails without subscribing (`usePushNotifications.tsx:65-78`). His new
   token rows say this did not happen, so rule it out for now.
4. **Service worker**: pushes are handled by `public/sw-push.js`. If the reinstall
   left no active SW registration when a push arrives, iOS drops it. `navigator
   .serviceWorker.ready` gated the subscribe, so the SW was live at 01:05.
5. **Sender-was-Dave** on the test message — trivially explains zero pushes.

## Cheapest way to confirm (no code)
- Have someone message Dave in a chat that has had **no** messages for 4+ minutes,
  with Dave not the sender, app fully backgrounded.
- Read `send-push-notification` edge logs for that moment: look for
  `[chat-throttle] Skipping push`, `Filtering out user`, and the per-token HTTP
  status lines. That single log line separates throttle from delivery.

## If Jordan names a ship, the smallest fix
Make the throttle per-recipient instead of per-chat (key `chat_id + user_id`) and
move it out of edge memory into a small table so it survives cold starts — plus a
one-time prune of Dave's three pre-reinstall Apple endpoints.

## Action
Diagnosis only. No code written.
