# Fix: weekly "Schedule Published" emails never reach the email queue

Current commit: `5afaa33d8`

## What's wrong (confirmed in code)
- The email-queue step tries to save each email with a "skip if it's already there" method. That method needs a database rule the queue table doesn't have, so every save fails.
- The failure is caught and ignored for each person, and the function still reports success with 0 sent. That's why Hemet (Nov 9–15) and Georgetown (Nov 16) got 0 emails.

## Fix (one function)
`supabase/functions/send-weekly-schedule-email/index.ts`
1. The queue step does a plain save with the same fields as today: from, to, subject, html, `source: "schedule_published"`, dedup key `schedule_{schedule_id}_{user_id}`, metadata `{}`.
2. If the database says "this email is already queued" (code `23505`, from the existing duplicate guard), treat it as already queued. No error. It counts as skipped, not as sent.
3. Any other error counts as a failure and gets logged.
4. Count sent, skipped and failed separately:
   - If anything failed and nothing was sent, return an error (HTTP 500 with `{ success:false, sentCount, skippedCount, failCount }`).
   - If some sent and some failed, return success with all three counts.
   - It never returns `{ success:true, sentCount:0 }` after a failure.
5. Unchanged: who gets the email (`deliverableEmail` + bounced/suppressed/inactive/@example.com list), the weekly email always goes out (no settings check), the template and subject, the source and dedup key, and the sign-in and preview paths.

## Tests
`supabase/functions/send-weekly-schedule-email/index.test.ts` gets new cases alongside the 6 existing ones. The real save step is tested with a fake queue that:
- saves fine → 1 sent, 200
- returns `23505` → no error, 1 skipped, 0 sent, not counted as a failure
- returns another error → 500, `success:false`, failCount 1
- is a mix → 200 with both counts

The existing recipient and policy tests must still pass. To test the save step directly, a small optional database-client hook goes into the queue step. It is used only by tests and doesn't change live behavior.

## After approval
- Build the change and run the function's tests.
- Do NOT deploy, publish, re-send or add anything to the queue until Ryan says so.
- When Ryan clears the deploy, the check is one service run on a known schedule. Then read back `email_queue` rows with `source=schedule_published`. Replaying past publishes is separate and waits for Jordan.

## Out of scope
No schema/RLS/migrations, no changes to notifyEmail or queue_notification_email, no other notification types, punch/kiosk, security piggybacks or native/iOS.

## Files
- `supabase/functions/send-weekly-schedule-email/index.ts`
- `supabase/functions/send-weekly-schedule-email/index.test.ts` (tests only)

## Rollback
Revert both files.
