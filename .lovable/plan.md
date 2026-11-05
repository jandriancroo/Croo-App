# Chat message multi-select delete with confirm

## What changes for people
- Long-press a message: opens reactions and Reply, and a **Select to delete** row (admins only, same as today's delete rights). That row deletes nothing. It only turns on select mode with that message already selected.
- In select mode, tapping or clicking a message toggles a round marker beside it: an empty circle when not selected, a **filled dot** when selected. You can select up to **5**. Trying a 6th shows the toast "You can delete up to 5 messages at a time" and nothing is added.
- A bar sits at the bottom of the chat (it replaces the typing box while select mode is on): "N selected", **Cancel** and **Delete**. Delete only shows once at least 1 message is selected. Cancel, or selecting nothing, leaves select mode.
- Delete opens a confirm box: "Delete N messages for everyone?" with a short preview of each one. Nothing is deleted unless the user presses **Delete for everyone**. Cancel keeps the messages.
- Desktop: the hover trash no longer deletes. It becomes a "Select" button (admins only) that enters the same select mode. After that, the steps and confirm box are the same as on mobile.
- No delete-for-me anywhere. The only delete is the existing delete-for-everyone.
- Long-press tap area: the message no longer moves when the menu opens. Text selection and the phone's own callout are turned off for the message area. After the menu opens, the finger has to lift and tap again, so the same touch can't land on a menu row. The menu also ignores taps for its first ~300 ms.

## Files touched (only these)
1. `src/components/messages/MessageBubble.tsx`
   - Remove both direct `onUnsend(message.id)` calls (desktop hover trash and the mobile "Delete for everyone" row).
   - New props: `selectMode`, `isSelected`, `onToggleSelect`, `onStartSelect`. Remove the `onUnsend` prop.
   - Selection marker (filled dot or empty circle) next to the bubble in select mode. In select mode a tap toggles selection, and reactions, reply and long-press are off.
   - Long-press stability: `select-none`, `-webkit-touch-callout: none`, `touch-action: manipulation` on the bubble column. No transform or scale changes on press. The menu ignores taps until ~300 ms after opening.
2. `src/components/messages/MemoizedMessageBubble.tsx`: pass the new props through, and add `selectMode` and `isSelected` to the memo comparison so the dots update.
3. `src/components/messages/ChatWindow.tsx`
   - Selection state (a list of ids, max 5, with the toast), the bottom bar, and a confirm box using the same AlertDialog pattern as Delete Chat.
   - `canUnsend={isAdmin}` stays. Select controls only show when `canUnsend` is true.
   - Clear the selection when switching chats.
4. `src/hooks/useChatActions.tsx`: add `handleUnsendMessages(ids)`. It loops the existing `unsendMessage` for each id, updates the screen right away, and shows one toast ("3 messages removed for everyone", or a partial-failure count). The single-message `handleUnsendMessage` stays but no button uses it any more.

5. `drizzle/migrations/0089_messages_member_only_edit_delete.sql` (new, applied in this ship): Andy's SQL exactly as given. It drops and recreates the two policies "Users can delete their own messages" and "Users can update their own messages". Both still require the sender, and now also require the user to still be in that chat. No other policies, columns or tables change.

### Important finding (checked on the live database)
The current update rule already lets people change only messages they sent themselves, and "unsend" works by updating the message. So today an admin who taps Delete on someone else's message gets a "removed" toast, but nothing actually changes. To keep the new screens honest:
- In select mode, only the user's **own** messages can be selected. Other people's messages show no marker and can't be tapped into the selection.
- The "Select to delete" row and the desktop Select button only appear on the user's own messages.
- `canUnsend={isAdmin}` is unchanged, so admins are still the only people who see these controls at all.

No changes to `src/lib/chatMessages.ts`, other security rules, columns, backend functions, native/iOS files, announcements feed, hiring chat (it doesn't use these components), Theo, punch/kiosk or shift offers.

## Confirmations
- No delete-for-me path is added.
- Nothing deletes without the confirm box being accepted. Both direct one-tap delete calls are removed.
- Who can delete is unchanged (admins via `canUnsend={isAdmin}`). Delete stays limited to your own messages, in chats you're still a member of.
- No punch or kiosk changes.

## Verify
- Browser checks on phone and desktop sizes, signed in as an admin in a test chat:
  - Long-press shows the menu, and the select row deletes nothing.
  - Selecting 1–5 shows filled dots. A 6th is blocked with the toast.
  - Pressing Cancel in the confirm box leaves the messages unchanged.
  - Desktop hover has no one-click delete.
- Confirm Delete is checked only on a message I send to a test chat myself. It is not used on real staff messages.
- Build passes. Then publish to croohq.com.

## Rollback
- Revert the four screen files above.
- Recreate the two policies with the old check only (`auth.uid() = sender_id`) for delete and update. The new migration file is kept, as earlier ones are.

## Database check after the migration
Read back both policies to confirm the chat-member check is there and the select and insert policies are unchanged. Then, in the browser, an admin unsends their own message in a test chat to confirm unsend still works.
