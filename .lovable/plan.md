# Dave Patrick — chat push not arriving after PWA reinstall

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
`src/hooks/useChatActions.tsx:37-66` — on send, fetches `chat_members` except the
sender, then invokes `send-push-notification` with
`notification_type: 'chat_messages'`, `data.chat_id`, `sender_id`. **No
`location_id` is passed**, so the per-location settings branch is skipped and only
the legacy `notification_preferences` gate applies
(`send-push-notification/index.ts:595-616`).

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
