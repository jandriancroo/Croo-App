# Fix: chat "Read" receipts list can't scroll on phone

## What changes for Jordan
Tapping **Read / Sent** under your own message opens a list that scrolls all the way through every Read and Unread name, on phone and desktop.

## Approach
One file only: `src/components/messages/ReadReceipts.tsx`.

- Swap the small pop-up for the same kind of window the announcement "Seen by" list uses (the existing Dialog), on all screen sizes, so phone and desktop behave the same.
- Title: "Read receipts". Body keeps the exact same two sections, counts ("Read · 3", "Unread · 11"), avatars, check icons, faded unread rows and "No recipients yet" text.
- List area: bounded height (`max-h-[60vh]`), `overflow-y-auto`, `overscroll-contain`, `touch-pan-y`, iOS momentum scrolling — so the finger scroll moves the list, not the chat behind it.
- Trigger button (Read / Sent with checks) stays identical.

## Not changing
- Sender-only visibility (`senderId !== currentUserId` → nothing shown).
- Fetch/query code, the is_active / appears_on_schedule filter, sender exclusion.
- No schema, RLS, migrations, other chat features, punch/kiosk, shift offers, native/iOS/TestFlight files.

## Verify
- Phone-size browser test (390×844) in a big chat: open receipts, scroll Unread to the last name, close; chat behind didn't scroll.
- Desktop check: same window opens and scrolls.
- Build passes. Then publish to croohq.com — only if the security-findings blocker from earlier is cleared by Jordan; otherwise I'll stop and report it.

## Report
Files changed, build result, commit SHA. Current commit before change: see readback at implementation.

## Rollback
Revert the one file.
