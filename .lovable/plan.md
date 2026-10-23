# Shift marketplace + support chats: Step 0 report

Report only. Nothing edited, migrated or published. Line numbers come from the current code.

## What the code shows today

**A. Open Shifts card** (`src/components/feed/OpenShiftCard.tsx`)
- "Take" appears in the compact row at L346 and as "Take This Shift" in the expanded card at L413. Both show only for manager+. Everyone else sees "Claim".
- The confirm heading in `ShiftMarketplaceDialogs.tsx` L35-42 says "Take this shift?" for everyone, team members included. No toast uses the word "take". Existing toasts: "Shift given to {who}" with Undo (L212-217), and "Shift claimed! Awaiting approval." (L230-232).
- Compact rows carry status pills ("Covered…", "N wants it · needs approval", L327-342) and a Review button that opens the expanded card (L344-350).
- Assign already exists, but only in the expanded card ("Assign to…", L417-426). A manager's own Claim and the Assign button both call the same assign action (L227-229).
- Who counts as manager+ (L50-52, `useUserRole` L67-75): manager, GM, admin, org admin, brand admin, super admin. **Shift managers are not included**, so they would see Claim only.

**B. Assign picker.** The helpers are in `src/lib/shiftMarketplace.ts`, not in Theo:
- `wouldHitSixthDay` (L44-48) only checks "6 or more days". A seventh day sets the same flag, so nothing tells sixth and seventh apart yet.
- `loadAssignCandidates` (L75-109) and `toAssignList` (L113-120) already sort people into clear, working and blocked. "Blocked" (unavailable, conflicting availability, overlapping shift) keeps its reason text.
- Theo's cover-list look is in `theoWizard.tsx` L704-750, and the amber flag box is at L681-685.

**C. Confirm dialog.** It already uses the shared `DayRows` (`ShiftMarketplaceDialogs.tsx` L44). It does not have the amber flag box yet.

**D. Phone alerts** (in `20261023033000_shift_marketplace_rpcs.sql`)
- **lost_claimer can fire from both actions.**
  - Whenever a shift turns "approved" (L234-239), the "lost" alert goes to every claimer except the winner (L209-214).
  - Approve (L71-87) needs at least one existing claim, then marks the shift approved.
  - Assign (L90-112) adds the chosen person as a claim, then marks the shift approved. The setting at L104-108 only silences the in-between "claimed" alert, not the "lost" one.
  - It has never fired live because no real shift has had two or more claimers when it was given out.
- **How to test lost_claimer:** at a test store, post a shift and have two test team members claim it. Then a manager approves one of them, or assigns it to anyone. The other claimer should get the "lost" alert, and the alert queue should show a lost_claimer row marked sent.
- **"Claimed" alert leaves out shift managers:** L195-198, the role list (manager, general_manager, admin, org_admin, brand_admin, super_admin). Per your instructions I'm leaving it alone.
- **Out-of-date note:** L223 reads `'url','/messages'` with the comment `-- /messages opens on the feed; the Shift Swaps bar sits at its top`. The Shift Swaps bar is gone, so this is now the Open Shifts card. Fixing it means a new migration that redefines the same function with only the comment changed. If the link should open somewhere else, tell me where.

**E. Support chats**
- Settings lists the super-admin rows in this order (`Settings.tsx` L93-117): System Alerts, Support chats, Theo Usage, and the rest. Support chats opens the panel inside Settings at 70% of the screen height (L331-333). It does not use the DM Inbox panel.
- The DM Inbox panel is in `DmPanel.tsx` L209-215: it slides up on phones and opens from the right on desktop.
- The ticket panel (`SupportChatPanel.tsx`) uses its own ticket rows (L638-686). It also holds `QUICK_REPLIES` (L98-104, shown at L589 and L832), `formatTicketNum` (L111) and the resolved notice (L627-630).
- DM rows are drawn inside `ChatList.tsx` (`renderChat`, L157), and bubbles in `MessageBubble.tsx` L224-230. Neither is a separate piece I can reuse directly.

**F. DM tab bar.** It is still a real problem, though a small one. The tabs are "DM's" plus "Hiring" when it applies, and Support is not a tab (`DmPanel.tsx` L58-61). The bar is laid out for 3 columns but has at most 2 tabs (L216-237), so it sits off-center. Fix: equal columns sized to the number of tabs. This changes presentation only.

## What I would build (after "go")

1. **Open Shifts card:** one slim row per shift (date, time, role, who posted). Remove the pills, the Review button and the expanded card. Show Claim for everyone and Assign for manager+. Change every "Take" to "Claim", including the dialog heading. A manager's own Claim shows a take-over warning plus the flags.
2. **Assign picker:** a new picker in the Theo cover-list style. Claimers come first, each with flags. Everyone else goes into a collapsible "Everyone else (N)" group. Flags: Sixth day, Seventh day, Unavailable. Unavailable people are dimmed but can still be picked, and nothing blocks. I'd add a small `dayCountAfter` helper next to `wouldHitSixthDay` so sixth and seventh day can be told apart. The existing helper stays as it is.
3. **Confirm dialog:** keep DayRows and add the amber flag box with a check list. Any flag carries over from the picker.
4. **Alerts:** no change. Optional: the comment-only migration above.
5. **Support:** move Support chats to the top of the super-admin list, with an unread badge from the ticket counts the panel already loads (no new polling). Tapping it opens the slide-up Inbox panel and stays on Settings. Inside: open tickets first, then resolved. Rows look like DM rows with a ticket tag, and resolved rows are green and softer. The thread uses the DM look. The quick-reply chips sit above the message box and are hidden on resolved threads, which show "Reply to reopen…". Ticket logic, loading, sending and resolving stay exactly as they are.
6. **DM tab bar:** equal columns.

## Files I would change
- `src/components/feed/OpenShiftCard.tsx`
- `src/components/schedule/ShiftMarketplaceDialogs.tsx`
- `src/lib/shiftMarketplace.ts` (adds a helper, changes nothing that exists)
- New `src/components/schedule/AssignPicker.tsx`
- `src/pages/Settings.tsx` (row order, badge, opens the panel)
- `src/components/support/SupportChatPanel.tsx` (**locked area**, presentation only)
- New `src/components/support/SupportInboxSheet.tsx`, which reuses the DmPanel sheet look
- `src/components/messages/DmPanel.tsx` (tab columns only)
- Optional: one comment-only migration

Files I won't touch: the punch clock, the kiosk, labor, cubes, the dock, nudges, toasts and the drawer, inventory, and ticket logic.

## Conflicts and questions
1. **The support panel is in a locked area.** Even presentation-only changes edit that file. Please confirm "unlock please" for presentation only.
2. **Shift managers:** should they see Assign? Today they don't count as manager+.
3. **Removing Review and the pills:** managers lose the "N wants it" count and the list of interested people on the card. The picker will show claimers first instead. OK?
4. **The note about `/messages`:** comment-only migration now, or leave it until the alert change you're holding?
5. **Seventh-day flag:** OK to add the new helper next to `wouldHitSixthDay` rather than changing it?

## Checks after building
Typecheck and the existing tests, plus new tests for the sixth/seventh-day flag and the claimers-first order. I'll check phone and iPad, light and dark. No publish.
